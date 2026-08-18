import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * Model testing is not available through the web UI in OMP mode.
 * OMP does not expose a model-test command via RPC.
 * Use the OMP CLI to test model connectivity directly.
 */
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ ok: false, error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json(
      { ok: false, error: "Content-Type must be application/json" },
      { status: 415 },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: "Model testing is not available through the web UI. Use the OMP CLI to test model connectivity.",
      feature_unavailable: true,
    },
    { status: 501 },
  );
}