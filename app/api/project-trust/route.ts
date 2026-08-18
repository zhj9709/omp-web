import { stat } from "fs/promises";
import { resolve } from "path";
import { NextResponse } from "next/server";
import { getAgentDir } from "@/lib/session-reader";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { getProjectTrustStatus } from "@/lib/project-trust";

export const dynamic = "force-dynamic";

async function validateCwd(value: unknown): Promise<
  { cwd: string } | { response: NextResponse }
> {
  if (typeof value !== "string" || !value.trim()) {
    return { response: NextResponse.json({ error: "cwd required" }, { status: 400 }) };
  }

  const cwd = resolve(value);
  try {
    if (!(await stat(cwd)).isDirectory()) {
      return { response: NextResponse.json({ error: "cwd must be a directory" }, { status: 400 }) };
    }
  } catch {
    return { response: NextResponse.json({ error: "Directory does not exist" }, { status: 400 }) };
  }

  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return { response: NextResponse.json({ error: "Access denied" }, { status: 403 }) };
  }
  return { cwd };
}

/**
 * GET /api/project-trust?cwd=<path>
 *
 * OMP v17.3.5 has no project-trust system. Returns a fixed "not applicable"
 * status: all projects are treated as trusted, and no trust gate exists.
 */
export async function GET(req: Request) {
  const result = await validateCwd(new URL(req.url).searchParams.get("cwd"));
  if ("response" in result) return result.response;
  return NextResponse.json(getProjectTrustStatus(result.cwd, getAgentDir()));
}

/**
 * POST /api/project-trust  body: { cwd }
 *
 * OMP v17.3.5 has no project-trust store. There is no `omp trust` CLI command,
 * no trust database in ~/.omp/agent/, and no trust gate in the resource loader.
 * Trust operations are not available.
 */
export async function POST(_req: Request) {
  return NextResponse.json(
    {
      error: "feature_unavailable",
      message: "OMP v17.3.5 does not have a project trust system. " +
        "Project resources (extensions, .agents/skills) are always loaded " +
        "without a trust gate. No trust decision is required.",
    },
    { status: 501 },
  );
}