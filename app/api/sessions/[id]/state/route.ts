import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";
import { computeColdContextUsage } from "@/lib/session-context-usage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const rpc = getRpcSession(id);
    if (rpc?.isAlive()) {
      const state = await rpc.send({ type: "get_state" });
      return NextResponse.json({ running: true, state });
    }

    const sessionPath = await resolveSessionPath(id);
    if (!sessionPath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    // No live omp process for this session (never started, or idle-reclaimed).
    // Reconstruct the last known context usage from the session file so the
    // UI can show it before the first prompt spawns the process. Null when the
    // file has no usable assistant entry or the model window is unknown — the
    // client treats it the same as a live session that reports nothing yet.
    const contextUsage = await computeColdContextUsage(sessionPath);
    return NextResponse.json({ running: false, state: { contextUsage } });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
