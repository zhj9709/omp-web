import { NextResponse } from "next/server";
import { getSessionEntries, resolveSessionPath } from "@/lib/session-reader";
import { extractLatestGoal } from "@/lib/goal";

export const dynamic = "force-dynamic";

// GET /api/sessions/[id]/goal - latest persisted goal-mode state (read-only;
// goal changes stream live via the goal_updated event).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const filePath = await resolveSessionPath(id);
  if (!filePath) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  try {
    const entries = getSessionEntries(filePath);
    const goal = extractLatestGoal(entries);
    return NextResponse.json({ goal });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
