import { NextResponse } from "next/server";
import {
  getSessionEntries,
  invalidateSessionListCache,
  resolveSessionPath,
} from "@/lib/session-reader";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import {
  fallbackTitle,
  generateSessionTitle,
  type GeneratedSessionTitle,
} from "@/lib/session-title";
import type { SessionEntry, TextContent } from "@/lib/types";

// POST /api/sessions/[id]/auto-name
// Generates a title from the session's first user message using the
// OMP-configured model, then persists it via set_session_name.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const entries = getSessionEntries(filePath);
    const firstMessage = firstUserMessageText(entries);

    const existing = getRpcSession(id);
    const { session } = existing?.isAlive()
      ? { session: existing }
      : await startRpcSession(id, filePath, undefined);

    let title: string;
    let usage: GeneratedSessionTitle["usage"];

    const connection = await session.getModelConnection();
    if (connection?.baseUrl) {
      try {
        const generated = await generateSessionTitle(connection, firstMessage);
        title = generated.title;
        usage = generated.usage;
      } catch (error) {
        console.error(
          "[omp-web] title generation failed, falling back to message prefix:",
          error instanceof Error ? error.message : error,
        );
        title = fallbackTitle(firstMessage);
      }
    } else {
      title = fallbackTitle(firstMessage);
    }

    await session.send({ type: "set_session_name", name: title });
    invalidateSessionListCache();

    return NextResponse.json({ title, usage: usage ?? null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

function firstUserMessageText(entries: SessionEntry[]): string {
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "user") continue;
    const content = entry.message.content;
    if (typeof content === "string") return content;
    const block = content.find(
      (b): b is TextContent => b.type === "text",
    );
    if (block?.text) return block.text;
  }
  return "";
}
