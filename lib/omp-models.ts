/**
 * OMP model/config adapter — reads OMP's models.db, config.yml, and
 * models.yaml to provide the same data shape the pi-web model/auth routes
 * expect.
 *
 * Uses only Node.js built-ins: node:sqlite (DatabaseSync), node:fs, node:os, node:path.
 * NEVER reads agent.db, broker.token, or any credential storage.
 * models.yaml is read for provider config only; API keys are stripped.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function ompAgentDir(): string {
  return join(homedir(), ".omp", "agent");
}

export function getOmpModelsDbPath(): string {
  return join(ompAgentDir(), "models.db");
}

export function getOmpConfigPath(): string {
  return join(ompAgentDir(), "config.yml");
}

export function getOmpModelsYamlPath(): string {
  return join(ompAgentDir(), "models.yaml");
}

// ---------------------------------------------------------------------------
// Model types (from models.db JSON blobs)
// ---------------------------------------------------------------------------

export interface OmpModel {
  id: string;
  name?: string;
  api?: string;
  provider?: string;
  baseUrl?: string;
  reasoning?: boolean;
  input?: string[];
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  contextWindow?: number;
  maxTokens?: number;
  thinking?: {
    mode?: string;
    efforts?: string[];
  };
}

export interface OmpModelListEntry {
  id: string;
  name: string;
  provider: string;
  api?: string;
  thinkingLevels: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: OmpModel["cost"];
}

export interface OmpDefaultModel {
  provider: string;
  modelId: string;
  thinkingLevel?: string;
}

export interface OmpModelRole {
  name: string;
  provider: string;
  modelId: string;
  thinkingLevel?: string;
}
 
 export interface OmpProviderInfo {
}

export interface OmpProviderInfo {
  id: string;
  name: string;
  hasApiKeyLogin: boolean;
  hasOAuth: boolean;
  modelCount: number;
}

// ---------------------------------------------------------------------------
// Minimal YAML parser for OMP config.yml (simple key-value and lists)
// ---------------------------------------------------------------------------

function parseSimpleYaml(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = raw.split("\n");
  let currentKey = "";
  let currentList: string[] = [];
  let currentMap: Record<string, string> = {};
  let inList = false;
  let inMap = false;
  let mapKey = "";

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const leading = line.length - line.trimStart().length;
    const content = trimmed;
    if (leading === 0) {
      // Flush any pending collection
      if (inList && currentKey) {
        result[currentKey] = [...currentList];
        currentList = [];
        inList = false;
      }
      if (inMap && mapKey) {
        result[mapKey] = { ...currentMap };
        currentMap = {};
        inMap = false;
      }

      const colonIdx = content.indexOf(":");
      if (colonIdx === -1) continue;
      currentKey = content.slice(0, colonIdx).trim();
      const value = content.slice(colonIdx + 1).trim();

      if (value === "" || value === "[]") {
        // Could be a list or map starting on next lines
        if (currentKey === "extensions" && value === "[]") {
          result[currentKey] = [];
        }
        // Peek ahead to determine type
        continue;
      }

      result[currentKey] = parseYamlValue(value);
      currentKey = "";
    } else if (leading === 2) {
      // Nested under a key
      if (content.startsWith("- ")) {
        // List item
        if (!inList) {
          inList = true;
          inMap = false;
          currentList = [];
        }
        currentList.push(content.slice(2).trim());
      } else {
        // Map item
        const colonIdx = content.indexOf(":");
        if (colonIdx === -1) continue;
        const mk = content.slice(0, colonIdx).trim();
        const mv = content.slice(colonIdx + 1).trim();

        if (!inMap) {
          inMap = true;
          inList = false;
          mapKey = currentKey;
          currentMap = {};
        }
        currentMap[mk] = mv;
      }
    } else if (leading === 4) {
      // Nested deeper (e.g., segmentOptions)
      if (inMap && content.includes(":")) {
        const colonIdx = content.indexOf(":");
        const mk = content.slice(0, colonIdx).trim();
        const mv = content.slice(colonIdx + 1).trim();
        currentMap[mk] = mv;
      }
    }
  }

  // Flush remaining
  if (inList && currentKey) {
    result[currentKey] = [...currentList];
  }
  if (inMap && mapKey) {
    result[mapKey] = { ...currentMap };
  }

  return result;
}

function parseYamlValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  const num = Number(value);
  if (!Number.isNaN(num) && value.trim() !== "") return num;
  return value;
}

// ---------------------------------------------------------------------------
// Model reading
// ---------------------------------------------------------------------------

let _modelsDb: DatabaseSync | null = null;

function getModelsDb(): DatabaseSync | null {
  if (_modelsDb) return _modelsDb;
  const dbPath = getOmpModelsDbPath();
  if (!existsSync(dbPath)) return null;
  try {
    _modelsDb = new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
  return _modelsDb;
}

export function readOmpModels(): Array<{
  providerId: string;
  models: OmpModel[];
}> {
  const db = getModelsDb();
  if (!db) return [];

  try {
    const rows = db
      .prepare("SELECT provider_id, models FROM model_cache")
      .all() as Array<{ provider_id: string; models: string }>;

    return rows.map((row) => ({
      providerId: row.provider_id,
      models: JSON.parse(row.models) as OmpModel[],
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Config reading
// ---------------------------------------------------------------------------

let _configCache: { config: Record<string, unknown>; ts: number } | null = null;

export function readOmpConfig(): Record<string, unknown> {
  const now = Date.now();
  if (_configCache && now - _configCache.ts < 30_000) return _configCache.config;

  const configPath = getOmpConfigPath();
  if (!existsSync(configPath)) return {};

  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = parseSimpleYaml(raw);
    _configCache = { config, ts: now };
    return config;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// models.yaml reading (sanitized — NEVER returns API keys)
// ---------------------------------------------------------------------------

let _modelsYamlCache: {
  data: Record<string, unknown>;
  ts: number;
} | null = null;

/**
 * Parse models.yaml into a providers map with API keys stripped.
 * Uses a line scanner because models.yaml has 3+ nesting levels that the
 * generic config.yml parser doesn't model.
 */
// Credential-shaped keys that must never reach the client, whatever spelling
// the YAML uses (apiKey, api_key, Authorization header, bearer tokens, …).
const SENSITIVE_YAML_KEYS = new Set([
  "apiKey", "api_key", "apikey", "api-key",
  "token", "accessToken", "access_token", "access-token",
  "secret", "secretKey", "secret_key",
  "authorization", "auth", "bearer",
  "headers",
]);

export function parseModelsYaml(raw: string): Record<string, unknown> {
  const lines = raw.split("\n");
  const providers: Record<string, Record<string, unknown>> = {};
  let currentProvider = "";

  for (const line of lines) {
    const leading = line.length - line.trimStart().length;
    const content = line.trim();
    if (content === "" || content.startsWith("#")) continue;

    if (leading === 0) {
      // Top-level key (providers:)
      continue;
    }

    if (leading === 2 && content.endsWith(":")) {
      // Provider id under `providers:`
      currentProvider = content.slice(0, -1).trim();
      providers[currentProvider] = {};
      continue;
    }

    if (leading === 4 && currentProvider) {
      const colonIdx = content.indexOf(":");
      if (colonIdx === -1) continue;
      const key = content.slice(0, colonIdx).trim();
      const value = content.slice(colonIdx + 1).trim();
      // NEVER store credentials of any spelling (apiKey/headers/tokens/…).
      if (SENSITIVE_YAML_KEYS.has(key)) continue;
      if (value === "") {
        // Nested block (discovery:, modelOverrides:) — skip its fields
        continue;
      }
      providers[currentProvider][key] = parseYamlValue(value);
    }
  }

  return { providers };
}

export function readOmpModelsYaml(): Record<string, unknown> {
  const now = Date.now();
  if (_modelsYamlCache && now - _modelsYamlCache.ts < 30_000) {
    return _modelsYamlCache.data;
  }

  const path = getOmpModelsYamlPath();
  if (!existsSync(path)) return {};

  try {
    const parsed = parseModelsYaml(readFileSync(path, "utf-8"));
    _modelsYamlCache = { data: parsed, ts: now };
    return parsed;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Model role parsing
// ---------------------------------------------------------------------------

const KNOWN_THINKING_LEVELS = [
  "off", "minimal", "low", "medium", "high", "xhigh", "max", "auto",
];

/**
 * Parse a model role string like "zijian/DeepSeek-V4-Pro:max" into
 * { provider, modelId, thinkingLevel? }.
 */
export function parseModelRole(
  role: string,
): OmpDefaultModel | null {
  const trimmed = role.trim();
  if (!trimmed) return null;

  // Format: provider/modelId:thinkingLevel
  const colonIdx = trimmed.lastIndexOf(":");
  let modelPart = trimmed;
  let thinkingLevel: string | undefined;

  if (colonIdx > 0 && colonIdx < trimmed.length - 1) {
    const suffix = trimmed.slice(colonIdx + 1);
    if (KNOWN_THINKING_LEVELS.includes(suffix)) {
      thinkingLevel = suffix;
      modelPart = trimmed.slice(0, colonIdx);
    }
  }

  const slashIdx = modelPart.indexOf("/");
  if (slashIdx <= 0 || slashIdx >= modelPart.length - 1) return null;

  return {
    provider: modelPart.slice(0, slashIdx),
    modelId: modelPart.slice(slashIdx + 1),
    thinkingLevel,
  };
}

// ---------------------------------------------------------------------------
// Derived data
// ---------------------------------------------------------------------------

export function getOmpModelList(): OmpModelListEntry[] {
  const providers = readOmpModels();
  const config = readOmpConfig();
  const disabledList = config.disabledProviders as string[] | undefined;
  const disabled = new Set(disabledList ?? []);
  const modelRoles = config.modelRoles as Record<string, string> | undefined;

  const thinkingLevelMap = new Map<string, string>();
  if (modelRoles) {
    for (const role of Object.values(modelRoles)) {
      const parsed = parseModelRole(role);
      if (parsed) {
        thinkingLevelMap.set(
          `${parsed.provider}/${parsed.modelId}`,
          parsed.thinkingLevel ?? "off",
        );
      }
    }
  }

  const result: OmpModelListEntry[] = [];

  for (const provider of providers) {
    if (disabled.has(provider.providerId)) continue;
    for (const model of provider.models) {
      const thinking = model.thinking?.efforts ?? [];
      result.push({
        id: model.id,
        name: model.name ?? model.id,
        provider: provider.providerId,
        api: model.api,
        thinkingLevels: thinking.length > 0 ? thinking : ["off"],
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        cost: model.cost,
      });
    }
  }

  return result;
}

export function getOmpDefaultModel(): OmpDefaultModel | null {
  const config = readOmpConfig();
  const defaultRole = config.modelRoles as Record<string, string> | undefined;
  if (!defaultRole?.default) return null;

  return parseModelRole(defaultRole.default);
}

export function getOmpThinkingLevelPins(): Record<string, string> {
  const config = readOmpConfig();
  const modelRoles = config.modelRoles as Record<string, string> | undefined;
  const pins: Record<string, string> = {};
  if (modelRoles) {
    for (const role of Object.values(modelRoles)) {
      const parsed = parseModelRole(role);
      if (parsed?.thinkingLevel) {
        pins[`${parsed.provider}/${parsed.modelId}`] = parsed.thinkingLevel;
      }
    }
  }
  return pins;
}

export function getOmpModelRoles(): OmpModelRole[] {
  const config = readOmpConfig();
  const modelRoles = config.modelRoles as Record<string, string> | undefined;
  const roles: OmpModelRole[] = [];
  if (modelRoles) {
    for (const [name, role] of Object.entries(modelRoles)) {
      const parsed = parseModelRole(role);
      if (!parsed) continue;
      roles.push({
        name,
        provider: parsed.provider,
        modelId: parsed.modelId,
        thinkingLevel: parsed.thinkingLevel,
      });
    }
  }
  // `default` first (it anchors new sessions), then the rest alphabetically.
  roles.sort((a, b) => {
    if (a.name === "default") return -1;
    if (b.name === "default") return 1;
    return a.name.localeCompare(b.name);
  });
  return roles;
}

export function getOmpProviders(): OmpProviderInfo[] {
  const providers = readOmpModels();
  const modelsYaml = readOmpModelsYaml();
  const config = readOmpConfig();
  const disabledList = config.disabledProviders as string[] | undefined;
  const disabled = new Set(disabledList ?? []);

  const yamlProviders = modelsYaml.providers as Record<string, unknown> | undefined;
  const yamlProviderIds = new Set(Object.keys(yamlProviders ?? {}));

  return providers
    .filter((p) => !disabled.has(p.providerId))
    .map((p) => ({
      id: p.providerId,
      name: p.providerId,
      hasApiKeyLogin: yamlProviderIds.has(p.providerId),
      hasOAuth: false,
      modelCount: p.models.length,
    }));
}