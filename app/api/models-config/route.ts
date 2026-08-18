import { NextResponse } from "next/server";
import { readOmpModelsYaml, getOmpModelList } from "@/lib/omp-models";

export const dynamic = "force-dynamic";

/**
 * GET /api/models-config — read-only view of models.yaml (sanitized).
 * NEVER returns API keys. Models are read from models.db.
 */
export async function GET() {
  const yamlConfig = readOmpModelsYaml();
  const modelList = getOmpModelList();

  // Build a response shape compatible with ModelsJson
  const providers: Record<string, Record<string, unknown>> = {};

  // Add providers from models.yaml
  const yamlProviders = yamlConfig.providers as Record<string, Record<string, unknown>> | undefined;
  if (yamlProviders) {
    for (const [id, provider] of Object.entries(yamlProviders)) {
      providers[id] = { ...provider, models: [] };
    }
  }

  // Add models from models.db to their providers
  for (const model of modelList) {
    if (!providers[model.provider]) {
      providers[model.provider] = { models: [] };
    }
    const providerModels = providers[model.provider].models as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(providerModels)) {
      providerModels.push({
        id: model.id,
        name: model.name,
        api: model.api,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        cost: model.cost,
        thinkingLevels: model.thinkingLevels,
      });
    }
  }

  return NextResponse.json({ providers });
}

/**
 * PUT /api/models-config — writing config is not supported through the web UI.
 * Configure models.yaml directly or use the OMP CLI.
 */
export async function PUT(_req: Request) {
  return NextResponse.json(
    {
      error: "Writing model configuration is not available through the web UI. Edit models.yaml directly.",
      feature_unavailable: true,
    },
    { status: 501 },
  );
}