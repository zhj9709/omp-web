import { closeSync, openSync, readSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join, normalize as normalizePath } from "path";
import type { AgentMessage, SessionEntry, SessionHeader, SessionInfo, SessionContext } from "./types";
import { normalizeToolCalls } from "./normalize";
import { projectIdentityKey } from "./project-identity";
import { sessionPathKey } from "./session-path";
import { resolveProject, type ProjectInfo } from "./worktree";

// ============================================================================
// OMP agent directory
// ============================================================================

export function getAgentDir(): string {
  return join(homedir(), ".omp", "agent");
}

// ============================================================================
// Project info attachment (unchanged from pi-web)
// ============================================================================

export async function attachSessionProjectInfo(sessions: SessionInfo[]): Promise<SessionInfo[]> {
  const uniqueCwds = [...new Set(sessions.map((s) => s.cwd).filter(Boolean))];
  const projectByCwd = new Map<string, ProjectInfo>();
  await Promise.all(uniqueCwds.map(async (cwd) => {
    projectByCwd.set(cwd, await resolveProject(cwd));
  }));

  return sessions.map((session) => {
    const project = session.cwd ? projectByCwd.get(session.cwd) : undefined;
    const projectRoot = project?.projectRoot ?? session.cwd;
    return {
      ...session,
      projectRoot,
      projectKey: projectIdentityKey(projectRoot),
      ...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
    };
  });
}

// ============================================================================
// Session list merging (unchanged from pi-web)
// ============================================================================

export function mergeSessionLists(
  persistedSessions: SessionInfo[],
  supplementalSessions: SessionInfo[],
): SessionInfo[] {
  const byId = new Map(supplementalSessions.map((session) => [session.id, session]));
  // A disk scan is authoritative once the JSONL exists. In particular, this
  // replaces a transient registry snapshot without briefly rendering two rows.
  for (const session of persistedSessions) byId.set(session.id, session);
  return [...byId.values()].sort((a, b) => b.modified.localeCompare(a.modified));
}

// ============================================================================
// OMP session directory scanning
// ============================================================================

const SESSIONS_DIR = join(homedir(), ".omp", "agent", "sessions");

function safeReadJsonlLine(filePath: string, lineIndex: number): Record<string, unknown> | null {
  const fd = openSync(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    const maxBytes = 64 * 1024;
    let position = 0;
    let linesFound = 0;

    while (position < maxBytes && linesFound <= lineIndex) {
      const buffer = Buffer.allocUnsafe(Math.min(4096, maxBytes - position));
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const data = buffer.subarray(0, bytesRead);
      const newlineIndex = data.indexOf(0x0a);
      chunks.push(newlineIndex === -1 ? data : data.subarray(0, newlineIndex));
      position += bytesRead;
      if (newlineIndex !== -1) {
        linesFound++;
        if (linesFound === lineIndex + 1) {
          const line = Buffer.concat(chunks).toString("utf8").trimEnd();
          if (!line) return null;
          try { return JSON.parse(line) as Record<string, unknown>; } catch { return null; }
        }
        chunks.length = 0;
        chunks.push(data.subarray(newlineIndex + 1));
      }
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

function readFirstTwoLines(filePath: string): { titleLine: Record<string, unknown> | null; headerLine: Record<string, unknown> | null } {
  const fd = openSync(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    const maxBytes = 64 * 1024;
    let position = 0;
    let linesFound = 0;
    const lines: (Record<string, unknown> | null)[] = [null, null];

    while (position < maxBytes && linesFound < 2) {
      const buffer = Buffer.allocUnsafe(Math.min(4096, maxBytes - position));
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const data = buffer.subarray(0, bytesRead);
      const newlineIndex = data.indexOf(0x0a);
      chunks.push(newlineIndex === -1 ? data : data.subarray(0, newlineIndex));
      position += bytesRead;
      if (newlineIndex !== -1) {
        const line = Buffer.concat(chunks).toString("utf8").trimEnd();
        try { lines[linesFound] = line ? JSON.parse(line) as Record<string, unknown> : null; } catch { /* skip */ }
        linesFound++;
        chunks.length = 0;
        chunks.push(data.subarray(newlineIndex + 1));
      }
    }
    return { titleLine: lines[0], headerLine: lines[1] };
  } finally {
    closeSync(fd);
  }
}

/**
 * Scan a single encoded-cwd directory for .jsonl session files.
 * Skips companion directories and non-.jsonl entries.
 * Bad files are skipped with diagnostics; the whole list never crashes.
 */
function scanEncodedCwdDir(dirPath: string, pathToId: Map<string, string>): SessionInfo[] {
  const results: SessionInfo[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return results; // skip unreadable directory
  }

  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const filePath = join(dirPath, name);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(filePath);
    } catch {
      continue; // skip unreadable file
    }
    if (!stat.isFile()) continue;

    const { titleLine, headerLine } = readFirstTwoLines(filePath);
    if (!headerLine || headerLine.type !== "session") {
      // OMP: line 1 is the title slot, line 2 is the session header.
      // If line 2 is not a valid session header, this is a malformed or
      // non-session .jsonl file (e.g. subagent transcript). Skip.
      continue;
    }

    const id = typeof headerLine.id === "string" ? headerLine.id : "";
    const cwd = typeof headerLine.cwd === "string" ? headerLine.cwd : "";
    const timestamp = typeof headerLine.timestamp === "string" ? headerLine.timestamp : "";
    const parentSession = typeof headerLine.parentSession === "string" ? headerLine.parentSession : undefined;

    // Title: prefer the session header's title field, then the title line slot
    const name_ = typeof headerLine.title === "string" ? headerLine.title
      : (titleLine && typeof titleLine.title === "string" ? titleLine.title : undefined);

    // Count messages and find first user message
    let messageCount = 0;
    let firstMessage = "(no messages)";
    try {
      const fd = openSync(filePath, "r");
      try {
        const buf = Buffer.allocUnsafe(4096);
        let pos = 0;
        let bytesRead: number;
        let lineCount = 0;
        let leftover = "";
        while ((bytesRead = readSync(fd, buf, 0, buf.length, pos)) > 0) {
          const chunk = buf.toString("utf8", 0, bytesRead);
          const lines = (leftover + chunk).split("\n");
          leftover = lines.pop() ?? "";
          for (const line of lines) {
            lineCount++;
            if (lineCount <= 2) continue; // skip title and header lines
            if (!line.trim()) continue;
            try {
              const entry = JSON.parse(line) as Record<string, unknown>;
              if (entry.type === "message" && entry.message && typeof entry.message === "object") {
                messageCount++;
                const msg = entry.message as Record<string, unknown>;
                if (msg.role === "user" && firstMessage === "(no messages)") {
                  const content = msg.content;
                  if (typeof content === "string") {
                    firstMessage = content;
                  } else if (Array.isArray(content)) {
                    const textBlock = content.find((b: unknown) =>
                      typeof b === "object" && b !== null && (b as Record<string, unknown>).type === "text"
                    ) as { text?: string } | undefined;
                    firstMessage = textBlock?.text ?? "(image message)";
                  }
                }
              }
            } catch { /* skip malformed line */ }
          }
          pos += bytesRead;
          if (pos > 512 * 1024) break; // bound: only scan first 512KB for stats
        }
      } finally {
        closeSync(fd);
      }
    } catch {
      // if file becomes unreadable, use defaults
    }

    cacheSessionPath(id, filePath);
    if (parentSession) pathToId.set(sessionPathKey(parentSession), ""); // placeholder
    cacheSessionPath(id, filePath);
    results.push({
      path: filePath,
      id,
      cwd,
      name: name_,
      created: timestamp,
      modified: stat.mtime.toISOString(),
      messageCount,
      firstMessage,
      parentSessionId: parentSession ? undefined : undefined, // resolved below in loadAllSessions
      transient: false,
    });
  }

  return results;
}

async function loadAllSessions(): Promise<SessionInfo[]> {
  const pathToId = new Map<string, string>();
  const allSessions: SessionInfo[] = [];

  // Scan OMP sessions directory: <sessionsDir>/<encoded-cwd>/<session>.jsonl
  let cwdDirs: string[];
  try {
    cwdDirs = readdirSync(SESSIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return []; // sessions dir doesn't exist or is unreadable
  }

  for (const dirName of cwdDirs) {
    const dirPath = join(SESSIONS_DIR, dirName);
    try {
      const sessions = scanEncodedCwdDir(dirPath, pathToId);
      allSessions.push(...sessions);
    } catch {
      // skip unreadable cwd directory
    }
  }

  // Build path-to-id map from all loaded sessions
  for (const s of allSessions) {
    pathToId.set(sessionPathKey(s.path), s.id);
  }

  // Resolve parentSessionId: look up the parent's id from the parentSession path
  for (const s of allSessions) {
    const header = readSessionHeader(s.path);
    if (header?.parentSession) {
      const parentId = pathToId.get(sessionPathKey(header.parentSession));
      (s as { parentSessionId?: string }).parentSessionId = parentId;
    }
  }

  return attachSessionProjectInfo(allSessions);
}
  }

  // Resolve parentSessionId after all sessions in this batch are collected
  for (const s of results) {
    if (s.parentSessionId === undefined) {
      // parentSessionId was intentionally left undefined during construction
      // It will be resolved when all sessions are loaded.
    }
  }

  return results;
}

async function loadAllSessions(): Promise<SessionInfo[]> {
  const pathToId = new Map<string, string>();
  const allSessions: SessionInfo[] = [];

  // Scan OMP sessions directory: <sessionsDir>/<encoded-cwd>/<session>.jsonl
  let cwdDirs: string[];
  try {
    cwdDirs = readdirSync(SESSIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return []; // sessions dir doesn't exist or is unreadable
  }

  for (const dirName of cwdDirs) {
    const dirPath = join(SESSIONS_DIR, dirName);
    try {
      const sessions = scanEncodedCwdDir(dirPath, pathToId);
      allSessions.push(...sessions);
    } catch {
      // skip unreadable cwd directory
    }
  }

  // Build path-to-id map from all loaded sessions
  for (const s of allSessions) {
    pathToId.set(sessionPathKey(s.path), s.id);
  }

  // Resolve parentSessionId: look up the parent's id from the parentSession path
  // stored in the session header. OMP session headers use parentSession? field.
  for (const s of allSessions) {
    if (s.parentSessionId === undefined) {
      // Re-read the header to get parentSession
      const header = readSessionHeader(s.path);
      if (header?.parentSession) {
        const parentId = pathToId.get(sessionPathKey(header.parentSession));
        (s as { parentSessionId?: string }).parentSessionId = parentId;
      }
    }
  }

  return attachSessionProjectInfo(allSessions);
}

// ============================================================================
// Session list caching (unchanged from pi-web)
// ============================================================================

export async function listAllSessions(options: { force?: boolean } = {}): Promise<SessionInfo[]> {
  if (options.force) invalidateSessionListCache();
  const generation = globalThis.__piSessionListGeneration ?? 0;

  if (globalThis.__piSessionListCache && Date.now() - globalThis.__piSessionListCache.ts < SESSION_LIST_CACHE_TTL_MS) {
    return globalThis.__piSessionListCache.data;
  }

  if (globalThis.__piSessionListPromise && globalThis.__piSessionListPromiseGeneration === generation) {
    return globalThis.__piSessionListPromise;
  }

  const loadPromise = loadAllSessions().then((data) => {
    if ((globalThis.__piSessionListGeneration ?? 0) !== generation) {
      return listAllSessions();
    }
    globalThis.__piSessionListCache = { data, ts: Date.now() };
    return data;
  });
  const trackedPromise = loadPromise.finally(() => {
    if (globalThis.__piSessionListPromise === trackedPromise) {
      globalThis.__piSessionListPromise = undefined;
      globalThis.__piSessionListPromiseGeneration = undefined;
    }
  });

  globalThis.__piSessionListPromise = trackedPromise;
  globalThis.__piSessionListPromiseGeneration = generation;
  return trackedPromise;
}

// ============================================================================
// Session path caches, stored in globalThis for hot-reload safety.
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
  var __piPathToSessionIdCache: Map<string, string> | undefined;
  var __piSessionListPromise: Promise<SessionInfo[]> | undefined;
  var __piSessionListPromiseGeneration: number | undefined;
  var __piSessionListGeneration: number | undefined;
  var __piSessionListCache: { data: SessionInfo[]; ts: number } | undefined;
}

const SESSION_LIST_CACHE_TTL_MS = 30_000;

export function invalidateSessionListCache(): void {
  globalThis.__piSessionListGeneration = (globalThis.__piSessionListGeneration ?? 0) + 1;
  globalThis.__piSessionListCache = undefined;
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

function getPathToIdCache(): Map<string, string> {
  if (!globalThis.__piPathToSessionIdCache) globalThis.__piPathToSessionIdCache = new Map();
  return globalThis.__piPathToSessionIdCache;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached) return cached;

  await listAllSessions();
  return getPathCache().get(sessionId) ?? null;
}

export async function resolveSessionIdByPath(filePath: string): Promise<string | undefined> {
  const pathKey = sessionPathKey(filePath);
  const cached = getPathToIdCache().get(pathKey);
  if (cached) return cached;

  await listAllSessions();
  return getPathToIdCache().get(pathKey);
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  const normalizedPath = normalizePath(filePath);
  const pathKey = sessionPathKey(normalizedPath);
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const previousPath = pathCache.get(sessionId);
  const previousPathKey = previousPath ? sessionPathKey(previousPath) : undefined;
  const previousSessionId = reverseCache.get(pathKey);
  const previousOwnerPath = previousSessionId ? pathCache.get(previousSessionId) : undefined;
  if (previousPathKey && previousPathKey !== pathKey && reverseCache.get(previousPathKey) === sessionId) {
    reverseCache.delete(previousPathKey);
  }
  if (
    previousSessionId &&
    previousSessionId !== sessionId &&
    previousOwnerPath &&
    sessionPathKey(previousOwnerPath) === pathKey
  ) {
    pathCache.delete(previousSessionId);
  }
  pathCache.set(sessionId, normalizedPath);
  reverseCache.set(pathKey, sessionId);
}

export function invalidateSessionPathCache(sessionId: string): void {
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const filePath = pathCache.get(sessionId);
  pathCache.delete(sessionId);
  const pathKey = filePath ? sessionPathKey(filePath) : undefined;
  if (pathKey && reverseCache.get(pathKey) === sessionId) {
    reverseCache.delete(pathKey);
  }
}

// ============================================================================
// Session header reading
// ============================================================================

/**
 * Read the session header from a JSONL file.
 * OMP format: line 1 is the title slot (type:"title"), line 2 is the session header.
 * This function reads the first two lines looking for the session header.
 * Returns the header as SessionHeader, or null if not found.
 */
export function readSessionHeader(filePath: string): SessionHeader | null {
  const fd = openSync(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    const maxHeaderBytes = 64 * 1024;
    let position = 0;
    let linesRead = 0;
    let firstLine: string | null = null;
    let headerLine: string | null = null;

    while (position < maxHeaderBytes && linesRead < 2) {
      const buffer = Buffer.allocUnsafe(Math.min(4096, maxHeaderBytes - position));
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const data = buffer.subarray(0, bytesRead);
      const newlineIndex = data.indexOf(0x0a);
      chunks.push(newlineIndex === -1 ? data : data.subarray(0, newlineIndex));
      position += bytesRead;
      if (newlineIndex !== -1) {
        linesRead++;
        const line = Buffer.concat(chunks).toString("utf8").trimEnd();
        if (linesRead === 1) {
          firstLine = line;
        } else {
          headerLine = line;
        }
        chunks.length = 0;
        chunks.push(data.subarray(newlineIndex + 1));
      }
    }

    // OMP: line 2 is the session header; line 1 is the title slot.
    // pi format: line 1 is the session header (no title slot).
    if (!headerLine && firstLine) {
      // Exactly one line found — treat it as the header (pi format).
      try {
        const parsed = JSON.parse(firstLine) as Record<string, unknown>;
        if (parsed.type === "session") {
          headerLine = firstLine;
        }
      } catch { /* fall through */ }
    }

    if (!headerLine) return null;
    try {
      const parsed = JSON.parse(headerLine) as Record<string, unknown>;
      if (parsed.type !== "session") return null;
      return {
        type: "session",
        version: typeof parsed.version === "number" ? parsed.version : undefined,
        id: typeof parsed.id === "string" ? parsed.id : "",
        timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : "",
        cwd: typeof parsed.cwd === "string" ? parsed.cwd : "",
        parentSession: typeof parsed.parentSession === "string" ? parsed.parentSession : undefined,
        title: typeof parsed.title === "string" ? parsed.title : undefined,
        titleSource: typeof parsed.titleSource === "string" ? parsed.titleSource : undefined,
      };
    } catch {
      return null;
    }
  } finally {
    closeSync(fd);
  }
}

// ============================================================================
// Session entry parsing (direct file read, no pi SDK dependency)
// ============================================================================

/**
 * Parse all session entries from a JSONL file.
 * Skips the title line (line 1) if present.
 * Malformed lines are silently skipped.
 */
export function getSessionEntries(filePath: string): SessionEntry[] {
  const entries: SessionEntry[] = [];
  const fd = openSync(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(65536);
    let pos = 0;
    let bytesRead: number;
    let leftover = "";
    let lineCount = 0;

    while ((bytesRead = readSync(fd, buf, 0, buf.length, pos)) > 0) {
      const chunk = buf.toString("utf8", 0, bytesRead);
      const lines = (leftover + chunk).split("\n");
      leftover = lines.pop() ?? "";

      for (const line of lines) {
        lineCount++;
        // OMP: line 1 is the title slot, skip it
        if (lineCount === 1) {
          const trimmed = line.trim();
          if (trimmed) {
            try {
              const parsed = JSON.parse(trimmed) as Record<string, unknown>;
              if (parsed.type === "title") continue; // title slot, skip
            } catch { /* fall through to parse as entry */ }
          }
        }
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const raw = JSON.parse(trimmed) as Record<string, unknown>;
          const entry = normalizeEntry(raw);
          if (entry) entries.push(entry);
        } catch {
          // skip malformed line
        }
      }
      pos += bytesRead;
    }

    // Handle leftover (last line without trailing newline)
    if (leftover.trim()) {
      try {
        const raw = JSON.parse(leftover.trim()) as Record<string, unknown>;
        const entry = normalizeEntry(raw);
        if (entry) entries.push(entry);
      } catch { /* skip */ }
    }
  } finally {
    closeSync(fd);
  }

  return entries;
}

/**
 * Normalize a raw JSONL line into a typed SessionEntry.
 * Handles both OMP and pi format differences:
 * - model_change: OMP uses "model" field (single string), pi uses "provider"/"modelId"
 * - thinking_level_change: OMP adds "configured" field
 * - title_change: OMP-only entry type
 * - custom: OMP uses "custom" type for tool execution tracking
 * Returns null for entries that are not valid session entries.
 */
function normalizeEntry(raw: Record<string, unknown>): SessionEntry | null {
  const type = raw.type;
  if (typeof type !== "string") return null;

  const base = {
    type,
    id: typeof raw.id === "string" ? raw.id : "",
    parentId: typeof raw.parentId === "string" ? raw.parentId : (raw.parentId === null ? null : null),
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : "",
  };

  switch (type) {
    case "message": {
      const message = raw.message as AgentMessage | undefined;
      if (!message) return null;
      return { ...base, type: "message", message } as SessionEntry;
    }
    case "model_change": {
      // OMP: single "model" field like "provider/modelId"
      // pi: separate "provider" and "modelId" fields
      const modelStr = typeof raw.model === "string" ? raw.model : undefined;
      const provider = modelStr ? modelStr.split("/")[0] : (typeof raw.provider === "string" ? raw.provider : undefined);
      const modelId = modelStr ? modelStr.split("/").slice(1).join("/") : (typeof raw.modelId === "string" ? raw.modelId : undefined);
      return {
        ...base,
        type: "model_change",
        provider,
        modelId,
        model: modelStr,
        resolvedModelIsFallback: typeof raw.resolvedModelIsFallback === "boolean" ? raw.resolvedModelIsFallback : undefined,
      } as SessionEntry;
    }
    case "thinking_level_change": {
      return {
        ...base,
        type: "thinking_level_change",
        thinkingLevel: typeof raw.thinkingLevel === "string" ? raw.thinkingLevel : "off",
        configured: raw.configured !== undefined ? (typeof raw.configured === "string" ? raw.configured : null) : undefined,
      } as SessionEntry;
    }
    case "compaction": {
      return {
        ...base,
        type: "compaction",
        summary: typeof raw.summary === "string" ? raw.summary : "",
        firstKeptEntryId: typeof raw.firstKeptEntryId === "string" ? raw.firstKeptEntryId : "",
        tokensBefore: typeof raw.tokensBefore === "number" ? raw.tokensBefore : 0,
        details: raw.details,
        fromHook: typeof raw.fromHook === "boolean" ? raw.fromHook : undefined,
      } as SessionEntry;
    }
    case "branch_summary": {
      return {
        ...base,
        type: "branch_summary",
        fromId: typeof raw.fromId === "string" ? raw.fromId : "",
        summary: typeof raw.summary === "string" ? raw.summary : "",
        details: raw.details,
        fromHook: typeof raw.fromHook === "boolean" ? raw.fromHook : undefined,
      } as SessionEntry;
    }
    case "custom": {
      return {
        ...base,
        type: "custom",
        customType: typeof raw.customType === "string" ? raw.customType : "",
        data: raw.data,
      } as SessionEntry;
    }
    case "custom_message": {
      return {
        ...base,
        type: "custom_message",
        customType: typeof raw.customType === "string" ? raw.customType : "",
        content: (raw.content as string | unknown[]) ?? "",
        details: raw.details,
        display: typeof raw.display === "boolean" ? raw.display : true,
      } as SessionEntry;
    }
    case "title_change": {
      return {
        ...base,
        type: "title_change",
        title: typeof raw.title === "string" ? raw.title : "",
        source: typeof raw.source === "string" ? raw.source : "auto",
      } as SessionEntry;
    }
    case "label": {
      return {
        ...base,
        type: "label",
        targetId: typeof raw.targetId === "string" ? raw.targetId : "",
        label: raw.label === undefined ? undefined : (typeof raw.label === "string" ? raw.label : undefined),
      } as SessionEntry;
    }
    case "session_info": {
      return {
        ...base,
        type: "session_info",
        name: typeof raw.name === "string" ? raw.name : undefined,
      } as SessionEntry;
    }
    case "session": {
      // session header line — skip (not an entry)
      return null;
    }
    case "title": {
      // title slot line — skip (not an entry)
      return null;
    }
    default:
      // Unknown entry type — skip gracefully
      return null;
  }
}

// ============================================================================
// Build session context (tree walking, replaces pi SDK)
// ============================================================================

/**
 * Walk the entry tree from the given leafId (or the last entry) following
 * parentId chains. Handles compaction: when a compaction entry is encountered,
 * skip to firstKeptEntryId and continue walking from there.
 *
 * Returns entries in chronological order (oldest first).
 */
function walkContextPath(
  entries: SessionEntry[],
  leafId: string | null | undefined,
  byId: Map<string, SessionEntry>,
): SessionEntry[] {
  if (leafId === null) return [];

  // Find the starting entry
  let currentId: string | null = leafId ?? null;
  if (!currentId) {
    // No leaf specified: use the last entry
    if (entries.length === 0) return [];
    currentId = entries[entries.length - 1].id;
  }

  const path: SessionEntry[] = [];
  const visited = new Set<string>();
  const MAX_DEPTH = 100_000;

  while (currentId && !visited.has(currentId) && path.length < MAX_DEPTH) {
    visited.add(currentId);
    const entry = byId.get(currentId);
    if (!entry) break;

    path.push(entry);

    if (entry.type === "compaction" && entry.firstKeptEntryId) {
      // Skip to the first kept entry after compaction
      currentId = entry.firstKeptEntryId;
    } else {
      currentId = entry.parentId;
    }
  }

  // Reverse to chronological order
  path.reverse();
  return path;
}

/**
 * Resolve the effective thinking level from the most recent
 * thinking_level_change entry on the active path.
 */
function resolveThinkingLevel(pathEntries: SessionEntry[]): string {
  for (let i = pathEntries.length - 1; i >= 0; i--) {
    const e = pathEntries[i];
    if (e.type === "thinking_level_change") {
      return e.thinkingLevel;
    }
  }
  return "off";
}

/**
 * Resolve the effective model from the most recent model_change entry
 * on the active path. OMP uses a single "model" field ("provider/modelId").
 */
function resolveModel(pathEntries: SessionEntry[]): { provider: string; modelId: string } | null {
  for (let i = pathEntries.length - 1; i >= 0; i--) {
    const e = pathEntries[i];
    if (e.type === "model_change") {
      if (e.model) {
        const slash = e.model.indexOf("/");
        if (slash !== -1) {
          return { provider: e.model.slice(0, slash), modelId: e.model.slice(slash + 1) };
        }
        return { provider: "", modelId: e.model };
      }
      if (e.provider || e.modelId) {
        return { provider: e.provider ?? "", modelId: e.modelId ?? "" };
      }
    }
  }
  return null;
}

export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean } = {},
): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  const contextEntries = walkContextPath(entries, leafId, byId);

  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  for (const entry of contextEntries) {
    const m = entryToUiMessage(entry, options);
    if (m) {
      messages.push(m);
      entryIds.push(entry.id);
    }
  }

  return {
    messages,
    entryIds,
    thinkingLevel: resolveThinkingLevel(contextEntries),
    model: resolveModel(contextEntries),
  };
}

// ============================================================================
// Helpers: timestamp, records, image handling
// ============================================================================

function parseEntryTimestamp(timestamp: string): number | undefined {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64ImageInfo(block: unknown): { bytes: number; mime?: string } | null {
  if (!isRecord(block) || block.type !== "image") return null;

  let data: string | undefined;
  let mime: string | undefined;
  if (typeof block.data === "string") {
    // OMP blob:sha256 references are not base64 — skip them
    if (block.data.startsWith("blob:sha256:")) return null;
    data = block.data;
    mime = typeof block.mimeType === "string" ? block.mimeType : undefined;
  } else if (isRecord(block.source) && block.source.type === "base64" && typeof block.source.data === "string") {
    if (block.source.data.startsWith("blob:sha256:")) return null;
    data = block.source.data;
    mime = typeof block.source.media_type === "string" ? block.source.media_type : undefined;
  }
  if (!data) return null;

  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return { bytes: Math.max(0, Math.floor(data.length * 3 / 4) - padding), mime };
}

function omitToolResultBase64Images(message: AgentMessage): AgentMessage {
  if (message.role !== "toolResult") return message;

  let omitted = 0;
  let bytes = 0;
  const mimes = new Set<string>();
  const content = message.content.filter((block) => {
    const image = base64ImageInfo(block);
    if (!image) return true;
    omitted += 1;
    bytes += image.bytes;
    if (image.mime) mimes.add(image.mime);
    return false;
  });
  if (omitted === 0) return message;

  const mimeText = mimes.size > 0 ? `: ${[...mimes].join(", ")}` : "";
  content.push({
    type: "text",
    text: `[${omitted} tool result image${omitted === 1 ? "" : "s"} omitted from initial history payload${mimeText}, ~${bytes} bytes]`,
  });
  return { ...message, content };
}

// ============================================================================
// Entry to UI message conversion
// ============================================================================

/**
 * Convert a session entry on the active branch into a UI message.
 * Returns null for entries that do not map to chat history (metadata, non-message types).
 */
function entryToUiMessage(
  entry: SessionEntry,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean },
): AgentMessage | null {
  switch (entry.type) {
    case "message": {
      const message = options.deferToolResultImages
        ? omitToolResultBase64Images(normalizeToolCalls(entry.message))
        : normalizeToolCalls(entry.message);
      if (!options.deferThinking || message.role !== "assistant") return message;
      return {
        ...message,
        content: message.content.map((block) => (
          block.type === "thinking" && block.thinking.trim() !== ""
            ? { ...block, thinking: "", deferred: true }
            : block
        )),
      };
    }
    case "compaction":
      return {
        role: "custom",
        customType: "compaction",
        content: entry.summary,
        display: true,
        details: {
          tokensBefore: entry.tokensBefore,
          firstKeptEntryId: entry.firstKeptEntryId,
        },
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "branch_summary":
      if (!entry.summary) return null;
      return {
        role: "user",
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${entry.summary}`,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "custom_message":
      return {
        role: "custom",
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    default:
      return null;
  }
}