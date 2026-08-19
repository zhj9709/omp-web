import { NextResponse } from "next/server";
import { readOmpModelsYaml, getOmpModelList } from "@/lib/omp-models";
import { ModelsConfigValidationError, writeModelsConfig } from "@/lib/models-config-writer";

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
 * PUT /api/models-config — deep-merge the client's config onto models.yaml.
 * Credentials and nested blocks the client never sees (apiKey, headers,
 * discovery, modelOverrides) are preserved from disk; see models-config-writer.
 */
export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    await writeModelsConfig(body);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ModelsConfigValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}