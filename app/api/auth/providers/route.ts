import { getOAuthProviders } from "@/lib/auth-login";

export const dynamic = "force-dynamic";

/**
 * OAuth providers from OMP RPC `get_login_providers`.
 * Each entry reports whether the provider is currently authenticated.
 */
export async function GET() {
  try {
    const providers = await getOAuthProviders();
    return Response.json({ providers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
