import { NextResponse } from "next/server";
import { getOmpProviders, readOmpModelsYaml } from "@/lib/omp-models";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

/**
 * GET /api/auth/api-key/[provider] — returns auth status.
 * NEVER returns the actual API key.
 */
export async function GET(_req: Request, { params }: Params) {
  const { provider } = await params;
  const providers = getOmpProviders();
  const found = providers.find((p) => p.id === provider);

  if (!found) {
    return NextResponse.json({
      provider,
      displayName: provider,
      configured: false,
      source: undefined,
      models: 0,
    });
  }

  return NextResponse.json({
    provider,
    displayName: found.name,
    configured: found.hasApiKeyLogin,
    source: found.hasApiKeyLogin ? "models_yaml" : undefined,
    models: found.modelCount,
  });
}

/**
 * POST /api/auth/api-key/[provider] — API key management is not supported
 * through the web UI in OMP mode. Configure API keys in models.yaml
 * directly or use the OMP CLI.
 */
export async function POST(req: Request, { params }: Params) {
  const { provider } = await params;
  return NextResponse.json(
    {
      error: `API key management for "${provider}" is not available through the web UI. Configure it in models.yaml or use the OMP CLI.`,
      feature_unavailable: true,
    },
    { status: 501 },
  );
}

/**
 * DELETE /api/auth/api-key/[provider] — API key removal is not supported
 * through the web UI in OMP mode.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const { provider } = await params;
  return NextResponse.json(
    {
      error: `API key removal for "${provider}" is not available through the web UI.`,
      feature_unavailable: true,
    },
    { status: 501 },
  );
}