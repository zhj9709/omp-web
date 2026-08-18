import { NextResponse } from "next/server";
import { resolveSessionPath, buildSessionContext, getSessionEntries } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { computeLeafId } from "@/lib/session-tree";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;
  const deferThinking = url.searchParams.has("deferThinking");
  const deferToolResultImages = url.searchParams.has("deferMedia");

  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc?.sessionFile || await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const entries = getSessionEntries(filePath);
    const effectiveLeafId = leafId ?? computeLeafId(entries) ?? undefined;
    const context = buildSessionContext(entries as never, effectiveLeafId, {
      deferThinking,
      deferToolResultImages,
    });

    return NextResponse.json({ context });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}