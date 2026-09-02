import { promises as fs } from "node:fs";
import { join, resolve as resolvePath, sep, win32 } from "node:path";
import { NextResponse } from "next/server";
import { getSessionEntries, resolveSessionPath } from "@/lib/session-reader";
import { isApiRequestAllowed } from "@/lib/request-security";

const SHA256_RE = /^[0-9a-f]{64}$/i;
// OMP CLI writes blobs as `<sha256>` (no extension for the raw bytes) plus a
// sibling `<sha256>.<ext>` that records the original mime. The sha256 file is
// the source of truth; the extension is just a hint for content-type sniffing.
const BLOB_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"] as const;

function mimeForExtension(ext: string): string {
  switch (ext) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    default: return "application/octet-stream";
  }
}

function resolveBlobsDir(): string {
  // Mirror lib/session-reader.ts getAgentDir() — keep both in sync if this
  // ever becomes configurable.
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (!home) throw new Error("Cannot resolve home directory");
  return join(home, ".omp", "agent", "blobs");
}

function isPathInside(parent: string, child: string): boolean {
  const normalizedParent = resolvePath(parent);
  const normalizedChild = resolvePath(child);
  const parentWithSep = normalizedParent.endsWith(sep) || normalizedParent.endsWith(win32.sep)
    ? normalizedParent
    : normalizedParent + sep;
  return normalizedChild === normalizedParent
    || normalizedChild.startsWith(parentWithSep);
}

async function tryReadBlob(blobsDir: string, sha256: string, ext: string, contentType: string): Promise<Response | null> {
  const candidate = join(blobsDir, sha256 + ext);
  if (!isPathInside(blobsDir, candidate)) return null;
  try {
    const bytes = await fs.readFile(candidate);
    const body = new Uint8Array(bytes);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(body.byteLength),
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return null;
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const { id, entryId } = await params;
  const url = new URL(req.url);
  const sha256 = url.searchParams.get("sha256") ?? "";

  if (!SHA256_RE.test(sha256)) {
    return NextResponse.json({ error: "Invalid sha256" }, { status: 400 });
  }
  if (!/^[0-9a-z]+$/i.test(entryId)) {
    return NextResponse.json({ error: "Invalid entryId" }, { status: 400 });
  }

  try {
    // Verify the session and entry exist so a sha256 can't be probed without
    // referencing a real message in a real session file.
    const filePath = await resolveSessionPath(id);
    if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const entry = getSessionEntries(filePath).find((candidate) => candidate.id === entryId);
    if (!entry || entry.type !== "message") {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    const blobsDir = resolveBlobsDir();

    // Probe every candidate extension; the first file that resolves wins.
    // The contents are identical regardless of which sibling exists (the
    // extension file is just a hint for the recorded mime).
    for (const ext of BLOB_EXTENSIONS) {
      const response = await tryReadBlob(blobsDir, sha256, ext, mimeForExtension(ext));
      if (response) return response;
    }

    // Fallback: probe the extension-less blob (OMP's raw-bytes form).
    const fallback = await tryReadBlob(blobsDir, sha256, "", "application/octet-stream");
    if (fallback) return fallback;

    return NextResponse.json({ error: "Blob not found" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}