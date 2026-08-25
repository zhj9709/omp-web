import { closeSync, openSync, readSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join, normalize as normalizePath } from "path";
import { StringDecoder } from "string_decoder";
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
  for (const session of persistedSessions) byId.set(session.id, session);
  return [...byId.values()].sort((a, b) => b.modified.localeCompare(a.modified));
}

// ============================================================================
// OMP session directory scanning
// ============================================================================

const SESSIONS_DIR = join(homedir(), ".omp", "agent", "sessions");

function readFileLines(filePath: string, maxLines: number): (Record<string, unknown> | null)[] {
  const fd = openSync(filePath, "r");
  try {
    const results: (Record<string, unknown> | null)[] = [];
    const maxBytes = 64 * 1024;
    const buffer = Buffer.allocUnsafe(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
    const text = buffer.toString("utf8", 0, bytesRead);
    const lines = text.split("\n");
    for (const line of lines) {
      if (results.length >= maxLines) break;
      const trimmed = line.trimEnd();
      if (!trimmed) continue;
      try { results.push(JSON.parse(trimmed) as Record<string, unknown>); } catch { results.push(null); }
    }
    return results;
  } finally {
    closeSync(fd);
  }
}

function scanEncodedCwdDir(dirPath: string): SessionInfo[] {
  const results: SessionInfo[] = [];
  let entries: string[];
  try { entries = readdirSync(dirPath); } catch { return results; }

  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const filePath = join(dirPath, name);
    let stat: ReturnType<typeof statSync>;
    try { stat = statSync(filePath); } catch { continue; }
    if (!stat.isFile()) continue;

    const [titleLine, headerLine] = readFileLines(filePath, 2);
    if (!headerLine || headerLine.type !== "session") continue;

    const id = typeof headerLine.id === "string" ? headerLine.id : "";
    if (!id) continue;

    const cwd = typeof headerLine.cwd === "string" ? headerLine.cwd : "";
    const timestamp = typeof headerLine.timestamp === "string" ? headerLine.timestamp : "";
    const name_ = typeof headerLine.title === "string" ? headerLine.title
      : (titleLine && typeof titleLine.title === "string" ? titleLine.title : undefined);

    // Quick stats: count messages and find first user message (bounded scan).
    // Cached per (mtimeMs, size): the scan reads up to 512KB per session, so
    // uncached scans of hundreds of sessions dominate list latency. The cache
    // is keyed by file identity, so any real change re-scans automatically.
    const statCacheKey = `${stat.mtimeMs}:${stat.size}`;
    const statsCache = getSessionStatsCache();
    const cachedStats = statsCache.get(filePath);
    let messageCount = cachedStats?.key === statCacheKey ? cachedStats.messageCount : 0;
    let firstMessage = cachedStats?.key === statCacheKey ? cachedStats.firstMessage : "(no messages)";
    if (cachedStats?.key !== statCacheKey) {
      try {
        const fd = openSync(filePath, "r");
        try {
          const buf = Buffer.allocUnsafe(4096);
          const decoder = new StringDecoder("utf8");
          let pos = 0;
          let bytesRead: number;
          let lineCount = 0;
          let leftover = "";
          while ((bytesRead = readSync(fd, buf, 0, buf.length, pos)) > 0) {
            const lines = (leftover + decoder.write(buf.subarray(0, bytesRead))).split("\n");
            leftover = lines.pop() ?? "";
            for (const line of lines) {
              lineCount++;
              if (lineCount <= 2) continue;
              const t = line.trim();
              if (!t) continue;
              try {
                const e = JSON.parse(t) as Record<string, unknown>;
                if (e.type === "message" && e.message != null && typeof e.message === "object") {
                  messageCount++;
                  const msg = e.message as Record<string, unknown>;
                  if (msg.role === "user" && firstMessage === "(no messages)") {
                    const c = msg.content;
                    if (typeof c === "string") { firstMessage = c; }
                    else if (Array.isArray(c)) {
                      const tb = c.find((b: unknown) => typeof b === "object" && b !== null && (b as Record<string, unknown>).type === "text") as { text?: string } | undefined;
                      firstMessage = tb?.text ?? "(image message)";
                    }
                  }
                }
              } catch { /* skip */ }
            }
            pos += bytesRead;
            if (pos > 512 * 1024) break;
          }
        } finally { closeSync(fd); }
      } catch { /* use defaults */ }
      statsCache.set(filePath, { key: statCacheKey, messageCount, firstMessage });
    }

    cacheSessionPath(id, filePath);

    results.push({
      path: filePath, id, cwd, name: name_,
      created: timestamp, modified: stat.mtime.toISOString(),
      messageCount, firstMessage,
      parentSessionId: undefined, transient: false,
    });
  }

  return results;
}

async function loadAllSessions(): Promise<SessionInfo[]> {
  const allSessions: SessionInfo[] = [];
  let cwdDirs: string[];
  try {
    cwdDirs = readdirSync(SESSIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name);
  } catch { return []; }

  for (const dirName of cwdDirs) {
    try { allSessions.push(...scanEncodedCwdDir(join(SESSIONS_DIR, dirName))); } catch { /* skip */ }
  }

  const pathToId = new Map<string, string>();
  for (const s of allSessions) pathToId.set(sessionPathKey(s.path), s.id);

  for (const s of allSessions) {
    const h = readSessionHeader(s.path);
    if (h?.parentSession) {
      (s as { parentSessionId?: string }).parentSessionId = pathToId.get(sessionPathKey(h.parentSession));
    }
  }

  return attachSessionProjectInfo(allSessions);
}

// ============================================================================
// Session list caching
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
    if ((globalThis.__piSessionListGeneration ?? 0) !== generation) return listAllSessions();
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
// Session path caches
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
  var __piPathToSessionIdCache: Map<string, string> | undefined;
  var __piSessionListPromise: Promise<SessionInfo[]> | undefined;
  var __piSessionListPromiseGeneration: number | undefined;
  var __piSessionListGeneration: number | undefined;
  var __piSessionListCache: { data: SessionInfo[]; ts: number } | undefined;
  var __piSessionStatsCache:
    | Map<string, { key: string; messageCount: number; firstMessage: string }>
    | undefined;
}

interface SessionStatsEntry {
  key: string;
  messageCount: number;
  firstMessage: string;
}

function getSessionStatsCache(): Map<string, SessionStatsEntry> {
  if (!globalThis.__piSessionStatsCache) globalThis.__piSessionStatsCache = new Map();
  return globalThis.__piSessionStatsCache;
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
  if (previousSessionId && previousSessionId !== sessionId && previousOwnerPath &&
      sessionPathKey(previousOwnerPath) === pathKey) {
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
  if (pathKey && reverseCache.get(pathKey) === sessionId) reverseCache.delete(pathKey);
}

// ============================================================================
// Session header reading
// ============================================================================

export function readSessionHeader(filePath: string): SessionHeader | null {
  const fd = openSync(filePath, "r");
  try {
    const maxHeaderBytes = 64 * 1024;
    const decoder = new StringDecoder("utf8");
    let position = 0;
    let linesRead = 0;
    let firstLine: string | null = null;
    let secondLine: string | null = null;
    let buf = "";

    while (position < maxHeaderBytes && linesRead < 2) {
      const buffer = Buffer.allocUnsafe(Math.min(4096, maxHeaderBytes - position));
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      buf += decoder.write(buffer.subarray(0, bytesRead));
      let idx: number;
      while ((idx = buf.indexOf("\n")) !== -1 && linesRead < 2) {
        linesRead++;
        const line = buf.slice(0, idx).trimEnd();
        buf = buf.slice(idx + 1);
        if (linesRead === 1) firstLine = line;
        else secondLine = line;
      }
    }

    // OMP format: line 1 is a title slot, line 2 is the session header.
    // Legacy pi format: line 1 is the session header. In the OMP layout the
    // title slot lives on the first line while the header is the second, so
    // both lines must be inspected independently (previously the first line
    // was only parsed when the second was not a session header, making the
    // OMP title slot unreadable and renames invisible to GET).
    let headerLine: string | null = null;
    let titleSlotLine: string | null = null;

    for (const candidate of [secondLine, firstLine]) {
      if (!candidate) continue;
      try {
        const parsed = JSON.parse(candidate) as Record<string, unknown>;
        if (parsed.type === "session") {
          if (headerLine === null) headerLine = candidate;
        } else if (parsed.type === "title") {
          if (titleSlotLine === null) titleSlotLine = candidate;
        }
      } catch { /* fall through */ }
    }

    if (!headerLine) return null;
    const parsed = JSON.parse(headerLine) as Record<string, unknown>;
    if (parsed.type !== "session") return null;

    // Prefer the header's own title; fall back to the title slot (OMP line 1).
    let title = typeof parsed.title === "string" ? parsed.title : undefined;
    let titleSource = typeof parsed.titleSource === "string" ? parsed.titleSource : undefined;
    if (title === undefined && titleSlotLine) {
      try {
        const slot = JSON.parse(titleSlotLine) as Record<string, unknown>;
        if (typeof slot.title === "string") title = slot.title;
        if (typeof slot.titleSource === "string") titleSource = slot.titleSource;
      } catch { /* fall through */ }
    }

    return {
      type: "session",
      version: typeof parsed.version === "number" ? parsed.version : undefined,
      id: typeof parsed.id === "string" ? parsed.id : "",
      timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : "",
      cwd: typeof parsed.cwd === "string" ? parsed.cwd : "",
      parentSession: typeof parsed.parentSession === "string" ? parsed.parentSession : undefined,
      title,
      titleSource,
    };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

// ============================================================================
// Session entry parsing
// ============================================================================

export function getSessionEntries(filePath: string): SessionEntry[] {
  const entries: SessionEntry[] = [];
  const fd = openSync(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(65536);
    const decoder = new StringDecoder("utf8");
    let pos = 0;
    let bytesRead: number;
    let leftover = "";
    let lineCount = 0;

    while ((bytesRead = readSync(fd, buf, 0, buf.length, pos)) > 0) {
      const lines = (leftover + decoder.write(buf.subarray(0, bytesRead))).split("\n");
      leftover = lines.pop() ?? "";

      for (const line of lines) {
        lineCount++;
        if (lineCount === 1) {
          const t = line.trim();
          if (t) {
            try { const p = JSON.parse(t) as Record<string, unknown>; if (p.type === "title") continue; } catch { /* fall through */ }
          }
        }
        const t = line.trim();
        if (!t) continue;
        try {
          const raw = JSON.parse(t) as Record<string, unknown>;
          const entry = normalizeEntry(raw);
          if (entry) entries.push(entry);
        } catch { /* skip malformed */ }
      }
      pos += bytesRead;
    }

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
      const modelStr = typeof raw.model === "string" ? raw.model : undefined;
      const provider = modelStr ? modelStr.split("/")[0] : (typeof raw.provider === "string" ? raw.provider : undefined);
      const modelId = modelStr ? modelStr.split("/").slice(1).join("/") : (typeof raw.modelId === "string" ? raw.modelId : undefined);
      return { ...base, type: "model_change", provider, modelId, model: modelStr,
        resolvedModelIsFallback: typeof raw.resolvedModelIsFallback === "boolean" ? raw.resolvedModelIsFallback : undefined } as SessionEntry;
    }
    case "thinking_level_change": {
      return { ...base, type: "thinking_level_change",
        thinkingLevel: typeof raw.thinkingLevel === "string" ? raw.thinkingLevel : "off",
        configured: raw.configured !== undefined ? (typeof raw.configured === "string" ? raw.configured : null) : undefined } as SessionEntry;
    }
    case "compaction": {
      return { ...base, type: "compaction",
        summary: typeof raw.summary === "string" ? raw.summary : "",
        firstKeptEntryId: typeof raw.firstKeptEntryId === "string" ? raw.firstKeptEntryId : "",
        tokensBefore: typeof raw.tokensBefore === "number" ? raw.tokensBefore : 0,
        details: raw.details, fromHook: typeof raw.fromHook === "boolean" ? raw.fromHook : undefined } as SessionEntry;
    }
    case "branch_summary": {
      return { ...base, type: "branch_summary",
        fromId: typeof raw.fromId === "string" ? raw.fromId : "",
        summary: typeof raw.summary === "string" ? raw.summary : "",
        details: raw.details, fromHook: typeof raw.fromHook === "boolean" ? raw.fromHook : undefined } as SessionEntry;
    }
    case "custom": {
      return { ...base, type: "custom",
        customType: typeof raw.customType === "string" ? raw.customType : "",
        data: raw.data } as SessionEntry;
    }
    case "custom_message": {
      return { ...base, type: "custom_message",
        customType: typeof raw.customType === "string" ? raw.customType : "",
        content: (raw.content as string | unknown[]) ?? "",
        details: raw.details,
        display: typeof raw.display === "boolean" ? raw.display : true } as SessionEntry;
    }
    case "title_change": {
      return { ...base, type: "title_change",
        title: typeof raw.title === "string" ? raw.title : "",
        source: typeof raw.source === "string" ? raw.source : "auto" } as SessionEntry;
    }
    case "label": {
      return { ...base, type: "label",
        targetId: typeof raw.targetId === "string" ? raw.targetId : "",
        label: raw.label === undefined ? undefined : (typeof raw.label === "string" ? raw.label : undefined) } as SessionEntry;
    }
    case "session_info": {
      return { ...base, type: "session_info",
        name: typeof raw.name === "string" ? raw.name : undefined } as SessionEntry;
    }
    case "mode_change": {
      return { ...base, type: "mode_change",
        mode: typeof raw.mode === "string" ? raw.mode : "",
        data: raw.data as Record<string, unknown> | undefined } as SessionEntry;
    }
    case "session":
    case "title":
      return null;
    default:
      return null;
  }
}

// ============================================================================
// Build session context (tree walking)
// ============================================================================

function walkContextPath(
  entries: SessionEntry[],
  leafId: string | null | undefined,
  byId: Map<string, SessionEntry>,
): SessionEntry[] {
  if (leafId === null) return [];

  let currentId: string | null = leafId ?? null;
  if (!currentId) {
    if (entries.length === 0) return [];
    currentId = entries[entries.length - 1].id;
  }

  // Walk the parent chain from the leaf toward the root (leaf → root).
  const chain: SessionEntry[] = [];
  const visited = new Set<string>();
  const MAX_DEPTH = 100_000;

  while (currentId && !visited.has(currentId) && chain.length < MAX_DEPTH) {
    visited.add(currentId);
    const entry = byId.get(currentId);
    if (!entry) break;
    chain.push(entry);
    currentId = entry.parentId;
  }

  // Find the first compaction on the active path (closest to the leaf).
  let compactionIndex = -1;
  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    if (entry.type === "compaction" && entry.firstKeptEntryId) {
      compactionIndex = i;
      break;
    }
  }

  if (compactionIndex === -1) {
    chain.reverse();
    return chain;
  }

  const compaction = chain[compactionIndex];
  if (compaction.type !== "compaction") {
    chain.reverse();
    return chain;
  }
  const firstKeptId = compaction.firstKeptEntryId;

  // Kept suffix: from the compaction's parentId back to firstKeptEntryId
  // (inclusive), following the parent chain. Entries before this boundary
  // were folded into the compaction summary and must not be replayed.
  const keptSuffix: SessionEntry[] = [];
  {
    let id: string | null = compaction.parentId;
    const keptVisited = new Set<string>();
    while (id && !keptVisited.has(id) && keptSuffix.length < MAX_DEPTH) {
      keptVisited.add(id);
      const entry = byId.get(id);
      if (!entry) break;
      keptSuffix.push(entry);
      if (id === firstKeptId) break;
      id = entry.parentId;
    }
    keptSuffix.reverse();
  }

  // Entries after the compaction (toward the leaf), in chronological order.
  const afterCompaction = chain.slice(0, compactionIndex).reverse();

  return [compaction, ...keptSuffix, ...afterCompaction];
}

function resolveThinkingLevel(pathEntries: SessionEntry[]): string {
  for (let i = pathEntries.length - 1; i >= 0; i--) {
    const entry = pathEntries[i];
    if (entry.type === "thinking_level_change") return entry.thinkingLevel;
  }
  return "off";
}

function resolveModel(pathEntries: SessionEntry[]): { provider: string; modelId: string } | null {
  for (let i = pathEntries.length - 1; i >= 0; i--) {
    const e = pathEntries[i];
    if (e.type !== "model_change") continue;
    if (e.model) {
      const slash = e.model.indexOf("/");
      return slash !== -1
        ? { provider: e.model.slice(0, slash), modelId: e.model.slice(slash + 1) }
        : { provider: "", modelId: e.model };
    }
    if (e.provider || e.modelId) return { provider: e.provider ?? "", modelId: e.modelId ?? "" };
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
    if (m) { messages.push(m); entryIds.push(entry.id); }
  }

  return {
    messages, entryIds,
    thinkingLevel: resolveThinkingLevel(contextEntries),
    model: resolveModel(contextEntries),
  };
}

// ============================================================================
// Helpers
// ============================================================================

function parseEntryTimestamp(timestamp: string): number | undefined {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function base64ImageInfo(block: unknown): { bytes: number; mime?: string } | null {
  if (typeof block !== "object" || block === null || Array.isArray(block)) return null;
  const b = block as Record<string, unknown>;
  if (b.type !== "image") return null;

  let data: string | undefined;
  let mime: string | undefined;
  if (typeof b.data === "string") {
    if (b.data.startsWith("blob:sha256:")) return null;
    data = b.data;
    mime = typeof b.mimeType === "string" ? b.mimeType : undefined;
  } else if (typeof b.source === "object" && b.source !== null && !Array.isArray(b.source)) {
    const src = b.source as Record<string, unknown>;
    if (src.type === "base64" && typeof src.data === "string") {
      if (src.data.startsWith("blob:sha256:")) return null;
      data = src.data;
      mime = typeof src.media_type === "string" ? src.media_type : undefined;
    }
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
        role: "custom", customType: "compaction",
        content: entry.summary, display: true,
        details: { tokensBefore: entry.tokensBefore, firstKeptEntryId: entry.firstKeptEntryId },
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
        role: "custom", customType: entry.customType,
        content: entry.content, display: entry.display,
        details: entry.details, timestamp: parseEntryTimestamp(entry.timestamp),
      };
    default:
      return null;
  }
}