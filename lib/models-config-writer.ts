/**
 * Write path for ~/.omp/agent/models.yaml.
 *
 * The read path (`readOmpModelsYaml`) is lossy by design: it strips
 * credentials (apiKey/headers/…) and flattens away nested blocks
 * (`discovery`, `modelOverrides`). A naive "dump whatever the client sends"
 * would destroy exactly those fields on every save. So a save is a deep
 * merge onto the on-disk file:
 *
 * - scalar fields the client provides (baseUrl, api, authHeader, …) win;
 * - fields the client never sees (apiKey, headers, discovery,
 *   modelOverrides, …) are inherited from disk;
 * - an empty string never overwrites a stored credential (the UI sends
 *   `undefined` for untouched secrets; "" is treated the same way);
 * - providers missing from the body are deleted — except that a provider
 *   re-added under a new name with the same baseUrl inherits the deleted
 *   provider's apiKey (rename keeps the credential);
 * - `models` is only written when it differs from the current models.db
 *   listing. The GET response injects the db listing into every provider,
 *   so an untouched round-trip would otherwise "freeze" dynamically
 *   discovered models (`discovery: proxy`) into a static list.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { dump, load } from "js-yaml";
import { lock } from "proper-lockfile";
import {
  getOmpModelList,
  getOmpModelsYamlPath,
  invalidateModelsYamlCache,
  invalidateOmpModelListCache,
  type OmpModelListEntry,
} from "./omp-models";

/** Client sent an structurally invalid body — route answers 400. */
export class ModelsConfigValidationError extends Error {}

/** Canonical record guard for yaml/JSON boundary data (no shared guard module exists in this app). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MODEL_COST_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;

/** Fields compared to detect a real edit versus a db round-trip. */
const MODEL_COMPARE_KEYS = [
  "id",
  "name",
  "api",
  "contextWindow",
  "maxTokens",
  "cost",
  "thinkingLevels",
] as const;

function canonicalModel(model: Record<string, unknown>): Record<string, unknown> {
  const canonical: Record<string, unknown> = {};
  for (const key of MODEL_COMPARE_KEYS) {
    if (model[key] !== undefined) canonical[key] = model[key];
  }
  return canonical;
}

/** Complete partial cost groups with zero; omit a cost group only when empty. */
function normalizeModelCost(model: Record<string, unknown>): void {
  if (!("cost" in model)) return;
  const cost = model.cost;
  if (!isRecord(cost)) {
    delete model.cost;
    return;
  }
  const provided = MODEL_COST_KEYS.filter((key) => cost[key] !== undefined);
  if (provided.length === 0) {
    delete model.cost;
    return;
  }
  if (provided.some((key) => typeof cost[key] !== "number" || !Number.isFinite(cost[key] as number))) {
    delete model.cost;
    return;
  }
  for (const key of MODEL_COST_KEYS) cost[key] = cost[key] ?? 0;
}

function sanitizeModels(
  models: unknown[],
  providerId: string,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const raw of models) {
    if (!isRecord(raw)) continue;
    if (typeof raw.id !== "string" || raw.id.trim().length === 0) {
      throw new ModelsConfigValidationError(
        `Provider ${providerId}: every model needs a non-empty string "id"`,
      );
    }
    const model = { ...raw };
    normalizeModelCost(model);
    out.push(model);
  }
  return out;
}

function dbModelsByProvider(dbModels: OmpModelListEntry[]): Map<string, string> {
  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const entry of dbModels) {
    const list = grouped.get(entry.provider) ?? [];
    list.push(canonicalModel(entry as unknown as Record<string, unknown>));
    grouped.set(entry.provider, list);
  }
  const serialized = new Map<string, string>();
  for (const [provider, list] of grouped) {
    // models.db has no stable row order between reads — compare sorted so a
    // reshuffled but otherwise identical listing is not mistaken for an edit.
    serialized.set(provider, JSON.stringify(list.map((m) => JSON.stringify(m)).sort()));
  }
  return serialized;
}

/**
 * Merge a client body onto the on-disk yaml. `diskRaw` is the raw file
 * content ("" treated as empty config). Returns the next full config object.
 */
export function mergeModelsConfig(
  diskRaw: string,
  body: unknown,
  dbModels: OmpModelListEntry[],
): Record<string, unknown> {
  if (!isRecord(body) || !isRecord(body.providers)) {
    throw new ModelsConfigValidationError(`Request body must be an object with a "providers" object`);
  }

  const disk = (diskRaw.trim() ? load(diskRaw) : {}) as unknown;
  const diskConfig = isRecord(disk) ? disk : {};
  const diskProviders = isRecord(diskConfig.providers) ? diskConfig.providers : {};
  const dbSerialized = dbModelsByProvider(dbModels);

  const nextProviders: Record<string, unknown> = {};
  for (const [providerId, bodyProviderRaw] of Object.entries(body.providers)) {
    if (!isRecord(bodyProviderRaw)) {
      throw new ModelsConfigValidationError(`Provider ${providerId}: must be an object`);
    }
    const diskProvider = isRecord(diskProviders[providerId]) ? diskProviders[providerId] : {};

    // Disk first, client scalars on top; "" and undefined never overwrite.
    const merged: Record<string, unknown> = { ...diskProvider };
    for (const [key, value] of Object.entries(bodyProviderRaw)) {
      if (key === "models") continue;
      if (value === undefined || value === "") continue;
      merged[key] = value;
    }

    // models: write only on a real edit, never for an untouched round-trip.
    if (bodyProviderRaw.models !== undefined) {
      if (!Array.isArray(bodyProviderRaw.models)) {
        throw new ModelsConfigValidationError(`Provider ${providerId}: "models" must be an array`);
      }
      const models = sanitizeModels(bodyProviderRaw.models, providerId);
      const edited = models.map((m) => JSON.stringify(canonicalModel(m))).sort();
      if (JSON.stringify(edited) !== (dbSerialized.get(providerId) ?? "[]")) {
        if (models.length > 0) merged.models = models;
        else delete merged.models;
      } else {
        delete merged.models;
      }
    }

    // A provider that exists only in models.db (no yaml fields of its own)
    // collapses to {} once the untouched db listing is stripped — writing it
    // would litter the file with empty entries.
    if (Object.keys(merged).length === 0 && !(providerId in diskProviders)) continue;

    nextProviders[providerId] = merged;
  }

  // Rename keeps the credential: a provider present on disk but missing from
  // the body was deleted or renamed; a same-baseUrl newcomer inherits its key.
  const deletedProviders = Object.entries(diskProviders).filter(
    ([id]) => !(id in nextProviders) && isRecord(diskProviders[id]),
  ) as Array<[string, Record<string, unknown>]>;
  for (const [, nextProvider] of Object.entries(nextProviders)) {
    const next = nextProvider as Record<string, unknown>;
    if (next.apiKey !== undefined || typeof next.baseUrl !== "string") continue;
    const donor = deletedProviders.find(([, old]) => old.baseUrl === next.baseUrl && old.apiKey !== undefined);
    if (donor) next.apiKey = donor[1].apiKey;
  }

  return { ...diskConfig, providers: nextProviders };
}

export async function writeModelsConfig(
  body: unknown,
  modelsPath = getOmpModelsYamlPath(),
): Promise<void> {
  const diskRaw = existsSync(modelsPath) ? readFileSync(modelsPath, "utf8") : "";
  const next = mergeModelsConfig(diskRaw, body, await getOmpModelList());
  const yaml = dump(next, { lineWidth: -1, noRefs: true });

  const dir = dirname(modelsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const persist = () => {
    if (existsSync(modelsPath)) {
      copyFileSync(modelsPath, `${modelsPath}.bak-${Date.now()}`);
    }
    const tmp = `${modelsPath}.tmp-${process.pid}`;
    writeFileSync(tmp, yaml, { mode: 0o600 });
    renameSync(tmp, modelsPath);
    invalidateModelsYamlCache();
    invalidateOmpModelListCache();
  };

  if (!existsSync(modelsPath)) {
    persist();
    return;
  }
  // Serialize with concurrent writers (and the OMP CLI) through a file lock.
  const release = await lock(modelsPath, {
    realpath: false,
    retries: { retries: 5, factor: 1.5, minTimeout: 200, maxTimeout: 2000 },
  });
  try {
    persist();
  } finally {
    await release().catch(() => {});
  }
}
