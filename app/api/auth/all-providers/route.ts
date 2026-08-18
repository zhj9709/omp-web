import { getOmpProviders } from "@/lib/omp-models";

export const dynamic = "force-dynamic";

/**
 * Providers that accept an API key.
 * OMP stores API key config in models.yaml. Providers listed here have
 * entries in models.yaml with an apiKey field.
 */
export async function GET() {
  const providers = getOmpProviders();
  const apiKeyProviders = providers
    .filter((p) => p.hasApiKeyLogin)
    .map((p) => ({
      id: p.id,
      displayName: p.name,
      configured: true, // Exists in models.yaml → has an API key configured
      source: "models_yaml",
      modelCount: p.modelCount,
      supportsOAuth: false,
    }));

  return Response.json({ providers: apiKeyProviders });
}