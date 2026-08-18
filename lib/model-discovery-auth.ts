import { existsSync, readFileSync } from "node:fs";
import { getOmpModelsYamlPath } from "./omp-models";

export interface ModelDiscoveryAuth {
  apiKey?: string;
  headers: Record<string, string>;
}

function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/**
 * Read the stored API key for a provider from models.yaml (server-side only).
 * NEVER returned to the client — used only to make an authenticated upstream request.
 */
function readStoredProviderApiKey(providerName: string): string | undefined {
  const path = getOmpModelsYamlPath();
  if (!existsSync(path)) return undefined;

  try {
    const raw = readFileSync(path, "utf-8");
    // models.yaml providers.<name>.apiKey — parse conservatively with a regex
    // to avoid pulling in a YAML dependency for one field. Every line after the
    // provider declaration must be indented, so the scan can never jump into a
    // later provider block (a sibling `b:` line has no leading whitespace).
    const escaped = providerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = raw.match(
      new RegExp(`^\\s*${escaped}:\\s*\\r?\\n(?:[ \\t]+[^\\n]*\\r?\\n)*?[ \\t]+apiKey:\\s*["']?([^"'\\n]+)`, "m"),
    );
    return match?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Read the configured baseUrl for a provider from models.yaml (server-side
 * only). Used to verify that a discovery request carrying a *stored* API key
 * targets the provider's own endpoint, never an arbitrary caller-supplied URL.
 */
export function readStoredProviderBaseUrl(providerName: string): string | undefined {
  const path = getOmpModelsYamlPath();
  if (!existsSync(path)) return undefined;

  try {
    const raw = readFileSync(path, "utf-8");
    const escaped = providerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = raw.match(
      new RegExp(`^\\s*${escaped}:\\s*\\r?\\n(?:[ \\t]+[^\\n]*\\r?\\n)*?[ \\t]+baseUrl:\\s*["']?([^"'\\n]+)`, "m"),
    );
    return match?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Resolve the auth (API key + headers) for an upstream model-list request.
 * Uses the key from the request body first, falling back to models.yaml.
 * The API key is used only server-side and never returned in a response.
 */
export function resolveModelDiscoveryAuth(
  providerName: string,
  provider: Record<string, unknown>,
): ModelDiscoveryAuth {
  const bodyKey =
    typeof provider.apiKey === "string" && provider.apiKey.trim()
      ? provider.apiKey.trim()
      : undefined;
  const apiKey = bodyKey ?? readStoredProviderApiKey(providerName);

  return {
    ...(apiKey ? { apiKey } : {}),
    headers: stringRecord(provider.headers),
  };
}