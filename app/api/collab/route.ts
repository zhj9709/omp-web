import { NextResponse } from "next/server";
import { buildCollabJoinUrl, getCollabConfig, shareSession } from "@/lib/collab";
import { resolveSessionPath } from "@/lib/session-reader";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * GET /api/collab
 *
 * Returns the collab/share configuration and the collab web client URL used by
 * /collab and /join links. No session is required to read this.
 */
export async function GET(_req: Request) {
  try {
    return NextResponse.json(getCollabConfig(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/collab  body: { action: "share" | "join", ... }
 *
 *   - "share": { sessionId, gist? } → runs `omp share` and returns the URL.
 *   - "join":  { link }            → returns the browser deep link for the
 *              collab web client.
 */
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as {
      action?: "share" | "join";
      sessionId?: string;
      gist?: boolean;
      link?: string;
    };

    switch (body.action) {
      case "share": {
        if (typeof body.sessionId !== "string" || !body.sessionId.trim()) {
          return NextResponse.json({ error: "sessionId required" }, { status: 400 });
        }
        const sessionPath = await resolveSessionPath(body.sessionId);
        if (!sessionPath) {
          return NextResponse.json(
            { error: "Session not found or not yet saved to disk" },
            { status: 404 },
          );
        }
        try {
          const result = await shareSession(sessionPath, { gist: body.gist === true });
          return NextResponse.json(result);
        } catch (error) {
          return NextResponse.json(
            {
              error: "share_failed",
              message: error instanceof Error ? error.message : String(error),
            },
            { status: 502 },
          );
        }
      }

      case "join": {
        if (typeof body.link !== "string" || !body.link.trim()) {
          return NextResponse.json({ error: "link required" }, { status: 400 });
        }
        const deepLink = buildCollabJoinUrl(body.link);
        return NextResponse.json({ url: deepLink });
      }

      default:
        return NextResponse.json(
          { error: `Unsupported action: ${String(body.action)}` },
          { status: 400 },
        );
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
