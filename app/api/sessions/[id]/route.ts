import { NextResponse } from "next/server";
import { existsSync, statSync, unlinkSync, readFileSync, writeFileSync } from "fs";
import { lock } from "proper-lockfile";
import {
  resolveSessionPath,
  resolveSessionIdByPath,
  buildSessionContext,
  readSessionHeader,
  getSessionEntries,
  listAllSessions,
  invalidateSessionListCache,
  invalidateSessionPathCache,
} from "@/lib/session-reader";
import { sessionPathKey } from "@/lib/session-path";
import { getRpcSession } from "@/lib/rpc-manager";
import { projectTreeForResponse } from "@/lib/project-tree";
import { computeSessionTotalActiveMs } from "@/lib/session-timing";
import { computeColdContextUsage } from "@/lib/session-context-usage";
import {
  buildSessionTree,
  computeLeafId,
  getSessionNameFromEntries,
} from "@/lib/session-tree";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    // omp deletes empty transient session files on exit; a live wrapper whose
    // file vanished is broken — resolve from disk instead of failing with ENOENT.
    let liveFile = liveRpc?.sessionFile;
    if (liveFile && !existsSync(liveFile)) liveFile = undefined;
    const resolvedPath = liveFile || await resolveSessionPath(id);
    if (!resolvedPath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const filePath = resolvedPath;
    const entries = getSessionEntries(filePath);
    const header = readSessionHeader(filePath);
    const leafId = computeLeafId(entries);
    const tree = projectTreeForResponse(buildSessionTree(entries));
    const searchParams = new URL(req.url).searchParams;
    const deferThinking = searchParams.has("deferThinking");
    const deferToolResultImages = searchParams.has("deferMedia");
    const expandCompaction = searchParams.has("expandCompaction");
    const context = buildSessionContext(entries as never, leafId, { deferThinking, deferToolResultImages, expandCompaction });
    const totalActiveMs = computeSessionTotalActiveMs(entries);

    // Context usage: live RPC sessions report it via get_state; cold sessions
    // reconstruct it from the session file tail. Null when unavailable.
    const contextUsage = liveRpc
      ? liveRpc.getContextUsage()
      : await computeColdContextUsage(filePath);

    let modified = header?.timestamp ?? new Date().toISOString();
    try { modified = statSync(filePath).mtime.toISOString(); } catch { /* use header timestamp */ }

    const parentSessionId = header?.parentSession
      ? await resolveSessionIdByPath(header.parentSession)
      : undefined;

    const info = header ? {
      path: filePath,
      id: header.id,
      cwd: header.cwd ?? "",
      name: getSessionNameFromEntries(entries, header.title),
      created: header.timestamp,
      modified,
      messageCount: context.messages.length,
      firstMessage: context.messages.find((m) => m.role === "user")
        ? (() => {
            const msg = context.messages.find((m) => m.role === "user")!;
            const c = (msg as { content: unknown }).content;
            return typeof c === "string" ? c : (Array.isArray(c) ? (c.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "" : "") || "(no messages)";
          })()
        : "(no messages)",
      parentSessionId,
      transient: !filePath,
      contextUsage,
    } : null;

    return NextResponse.json({
      sessionId: id,
      filePath,
      info,
      leafId,
      tree,
      context,
      contextUsage,
      totalActiveMs,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/sessions/[id]  body: { name: string }
// PATCH /api/sessions/[id]
// Renames the session. Live runtime sessions go through OMP RPC
// (set_session_name keeps the runtime + file in sync); idle sessions have the
// title slot of their session file rewritten directly.
async function updateSessionHeaderName(filePath: string, name: string): Promise<void> {
  // The omp child may append to this file concurrently; a lock prevents the
  // read-modify-write cycle from dropping entries appended mid-rewrite.
  const release = await lock(filePath, {
    realpath: false,
    retries: { retries: 5, factor: 1.5, minTimeout: 200, maxTimeout: 2000 },
  });
  try {
    const content = readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    let updated = false;

    // OMP format: line 1 is the title slot {"type":"title","title":...,"pad":...}
    // and is the field every read path (readSessionHeader, list scans) consumes.
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimEnd();
      if (!trimmed) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (parsed.type !== "title") continue;
      parsed.title = name;
      parsed.updatedAt = new Date().toISOString();
      lines[i] = JSON.stringify(parsed);
      updated = true;
      break;
    }

    if (!updated) {
      // Legacy pi format without a title slot: fall back to the session header.
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trimEnd();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          if (parsed.type !== "session") continue;
          parsed.title = name;
          lines[i] = JSON.stringify(parsed);
          break;
        } catch {
          continue;
        }
      }
    }

    writeFileSync(filePath, lines.join("\n"), "utf8");
  } finally {
    await release().catch(() => {});
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json().catch(() => null) as { name?: unknown } | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Session name cannot be empty" }, { status: 400 });
    }

    const session = getRpcSession(id);
    if (session?.isAlive()) {
      await session.send({ type: "set_session_name", name });
    } else {
      const filePath = await resolveSessionPath(id);
      if (!filePath) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      await updateSessionHeaderName(filePath, name);
    }

    invalidateSessionListCache();
    return NextResponse.json({ ok: true, name });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/sessions/[id]
// Deletes the session .jsonl file directly and cascade-reparents any children
// (sessions whose parentSession header points at this file) to this session's
// own parent, so the sidebar tree does not orphan them.
async function reparentSessionFile(filePath: string, newParent: string | undefined): Promise<void> {
  const release = await lock(filePath, {
    realpath: false,
    retries: { retries: 5, factor: 1.5, minTimeout: 200, maxTimeout: 2000 },
  });
  try {
    const content = readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimEnd();
      if (!trimmed) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (parsed.type !== "session") continue;
      if (newParent === undefined) {
        delete parsed.parentSession;
      } else {
        parsed.parentSession = newParent;
      }
      lines[i] = JSON.stringify(parsed);
      break;
    }
    writeFileSync(filePath, lines.join("\n"), "utf8");
  } finally {
    await release().catch(() => {});
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Stop a live RPC session before unlinking, or the omp child keeps
    // appending to the unlinked inode and the run's data is lost.
    const liveSession = getRpcSession(id);
    if (liveSession?.isAlive()) {
      await liveSession.shutdown();
    }

    // Children are forked from this session; reparent them to this session's
    // parent (or detach them if this session is a root) before unlinking.
    const deletedHeader = readSessionHeader(filePath);
    const newParent = deletedHeader?.parentSession;

    const allSessions = await listAllSessions({ force: true });
    const children = allSessions.filter((s) => {
      if (s.path === filePath) return false;
      const header = readSessionHeader(s.path);
      return !!header?.parentSession &&
        sessionPathKey(header.parentSession) === sessionPathKey(filePath);
    });

    unlinkSync(filePath);

    for (const child of children) {
      try {
        await reparentSessionFile(child.path, newParent);
      } catch {
        // Best-effort: a failed reparent only leaves a dangling parent ref.
      }
    }

    invalidateSessionListCache();
    invalidateSessionPathCache(id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}