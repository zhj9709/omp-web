import { NextResponse } from "next/server";
import {
  ConfigValidationError,
  readClientConfig,
  writeConfigEntries,
} from "@/lib/config-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/config — full client-safe view of config.yml.
 * Credential values are redacted to "__set__" (present) or absent.
 */
export async function GET() {
  return NextResponse.json({ values: readClientConfig() });
}

/**
 * PUT /api/config — deep-merge `{ entries: { "dotted.key": value } }` onto
 * config.yml. Omitted keys are preserved; credential keys keep their stored
 * value unless a new non-empty value is supplied.
 */
export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const entries = (body as Record<string, unknown>)?.entries;
  try {
    await writeConfigEntries(entries as Record<string, unknown>);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
