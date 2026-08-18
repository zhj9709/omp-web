import { NextResponse } from "next/server";
import { getOmpModelList, getOmpDefaultModel, getOmpThinkingLevelPins, getOmpModelRoles } from "@/lib/omp-models";
export const dynamic = "force-dynamic";

const modelNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareModelEntries(
  a: { id: string; name: string; provider: string },
  b: { id: string; name: string; provider: string },
): number {
  return modelNameCollator.compare(a.name || a.id, b.name || b.id)
    || modelNameCollator.compare(a.provider, b.provider)
    || modelNameCollator.compare(a.id, b.id);
}

export async function GET() {
  try {
    const modelList = getOmpModelList();
    const defaultModel = getOmpDefaultModel();
    const thinkingLevelPins = getOmpThinkingLevelPins();
    const modelRoles = getOmpModelRoles();

    const models: Record<string, string> = {};
    const thinkingLevels: Record<string, string[]> = {};
    const thinkingLevelMaps: Record<string, Record<string, string | null>> = {};
    const modelEntries: { id: string; name: string; provider: string }[] = [];

    for (const model of modelList) {
      // Colon-separated key matches the pi-web frontend (`provider:modelId`).
      const key = `${model.provider}:${model.id}`;
      models[key] = model.name;
      thinkingLevels[key] = model.thinkingLevels;
      thinkingLevelMaps[key] = Object.fromEntries(
        model.thinkingLevels.map((l) => [l, l]),
      );
      modelEntries.push({
        id: model.id,
        name: model.name,
        provider: model.provider,
      });
    }

    modelEntries.sort(compareModelEntries);

    return NextResponse.json({
      models,
      modelList: modelEntries,
      defaultModel: defaultModel
        ? { provider: defaultModel.provider, modelId: defaultModel.modelId }
        : null,
      modelRoles: modelRoles.map((role) => ({
        name: role.name,
        provider: role.provider,
        modelId: role.modelId,
        thinkingLevel: role.thinkingLevel ?? null,
      })),
      thinkingLevels,
      thinkingLevelMaps,
      thinkingLevelPins,
    });
  } catch (error) {
    return NextResponse.json({
      models: {},
      modelList: [],
      defaultModel: null,
      modelRoles: [],
      thinkingLevels: {},
      thinkingLevelMaps: {},
      thinkingLevelPins: {},
      modelError: "Model list is temporarily unavailable. Check your configuration and try again.",
    });
  }
}