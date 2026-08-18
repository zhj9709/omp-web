import { NextResponse } from "next/server";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  resolveSessionPath,
  readSessionHeader,
} from "@/lib/session-reader";
import {
  getRpcSession,
  startRpcSession,
} from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

function safeFilename(name: string): string {
  const cleaned = name
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || "session";
}

// GET /api/sessions/[id]/export
// Exports the full session transcript to a self-contained HTML file using the
// OMP RPC `export_html` command. The OMP process renders the canonical export
// (embedded styles, tool call/result renderers) to a temp file, which is then
// served as an attachment download.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let tempDir: string | undefined;
  try {
    const rpc = getRpcSession(id);
    const existing = rpc?.isAlive() ? rpc : undefined;
    const filePath = existing?.sessionFile || await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const header = readSessionHeader(filePath);
    const session = existing ?? (await startRpcSession(id, filePath, header?.cwd)).session;

    tempDir = await mkdtemp(join(tmpdir(), "omp-web-export-"));
    const outputPath = join(tempDir, "session.html");

    const result = await session.send({ type: "export_html", outputPath });
    const exportedPath =
      (result as { path?: string } | null)?.path || outputPath;

    const html = await readFile(exportedPath, "utf8");

    const title = header?.title || header?.id || "Session";
    const headers: Record<string, string> = {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${safeFilename(title)}.html"`,
    };

    return new NextResponse(html, { headers });
  } catch (error) {
    console.error(
      "[omp-web] session export failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  } finally {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup; the OS temp dir will reclaim it
      }
    }
  }
}
