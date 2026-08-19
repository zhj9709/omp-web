import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { parseSubagentSpawns } from "@/lib/subagent-history";

export const dynamic = "force-dynamic";

/**
 * GET /api/sessions/[id]/subagents — subagents spawned in a session, rebuilt
 * from the session file's `task` tool calls. This is the disk fallback for
 * sessions whose live subagent state lives in a process the web server does
 * not own (e.g. CLI-driven sessions).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const filePath = await resolveSessionPath(id);
  if (!filePath) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return NextResponse.json(
    { spawns: parseSubagentSpawns(filePath) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
