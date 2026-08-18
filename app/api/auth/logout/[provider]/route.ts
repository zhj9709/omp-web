import { execFile } from "child_process";
import { promisify } from "util";
import { getOmpBinary } from "@/lib/auth-login";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

/**
 * OAuth logout. OMP has no `logout` RPC command; credentials live in the local
 * auth-broker store, so we shell out to `omp auth-broker logout <provider>`.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!provider) {
    return Response.json({ error: "provider is required" }, { status: 400 });
  }

  try {
    await execFileAsync(getOmpBinary(), ["auth-broker", "logout", provider], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return Response.json({ ok: true });
  } catch (error) {
    const stderr =
      error instanceof Error
        ? ((error as NodeJS.ErrnoException & { stderr?: string }).stderr ?? error.message)
        : String(error);
    return Response.json(
      { error: `Logout failed: ${stderr}` },
      { status: 500 },
    );
  }
}
