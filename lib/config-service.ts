/**
 * Full-fidelity read/write service for ~/.omp/agent/config.yml.
 *
 * The existing `readOmpConfig` (omp-models.ts) uses a lossy line scanner meant
 * for a few known keys; the settings UI needs the whole file, so this service
 * goes through js-yaml both ways. Credential keys (marked `credential: true`
 * in the settings schema) are stripped from GET responses and preserved from
 * disk on PUT unless the client supplies a new non-empty value — same contract
 * as models-config-writer. Every write makes a timestamped backup, swaps the
 * file atomically at mode 0600, and holds a proper-lockfile lock.
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
import { getOmpConfigPath } from "./omp-models";
import { SETTINGS_SCHEMA } from "./settings-schema";

export class ConfigValidationError extends Error {}

/** Dotted config.yml paths that hold credentials (from the binary's schema). */
const CREDENTIAL_KEYS = new Set(
  SETTINGS_SCHEMA.filter((s) => s.credential).map((s) => s.key),
);

function getPath(obj: Record<string, unknown>, dotted: string): unknown {
  let cur: unknown = obj;
  for (const part of dotted.split(".")) {
    if (!isRecord(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function setPath(obj: Record<string, unknown>, dotted: string, value: unknown): void {
  const parts = dotted.split(".");
  let cur = obj;
  for (const part of parts.slice(0, -1)) {
    const next = cur[part];
    if (!isRecord(next)) {
      cur[part] = {};
    }
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

function deletePath(obj: Record<string, unknown>, dotted: string): void {
  const parts = dotted.split(".");
  let cur: unknown = obj;
  for (const part of parts.slice(0, -1)) {
    if (!isRecord(cur)) return;
    cur = cur[part];
  }
  if (isRecord(cur)) delete cur[parts[parts.length - 1]];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read config.yml as a full nested object ({} when missing/unparseable). */
export function readConfigYaml(configPath = getOmpConfigPath()): Record<string, unknown> {
  if (!existsSync(configPath)) return {};
  try {
    const parsed = load(readFileSync(configPath, "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Client-safe view: credential values replaced by true (so the UI can show "set"). */
export function readClientConfig(configPath = getOmpConfigPath()): Record<string, unknown> {
  const config = readConfigYaml(configPath);
  const redacted = structuredClone(config);
  for (const key of CREDENTIAL_KEYS) {
    if (getPath(redacted, key) !== undefined) {
      deletePath(redacted, key);
      setPath(redacted, key, "__set__");
    }
  }
  return redacted;
}

/**
 * Deep-merge client-supplied entries onto the on-disk config.
 * `entries` maps dotted keys to values:
 * - `undefined` leaves the stored value untouched;
 * - credential keys with `""`, `"__set__"` (the redaction marker) or undefined
 *   keep the stored secret;
 * - anything else overwrites (including null, which writes YAML null).
 * Keys the client never mentions are preserved verbatim.
 */
export function mergeConfigEntries(
  diskConfig: Record<string, unknown>,
  entries: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(entries)) {
    throw new ConfigValidationError(`"entries" must be an object mapping dotted keys to values`);
  }
  const next = structuredClone(diskConfig);
  for (const [key, value] of Object.entries(entries)) {
    if (typeof key !== "string" || key.trim() === "" || key.split(".").some((p) => p === "")) {
      throw new ConfigValidationError(`Invalid config key: ${JSON.stringify(key)}`);
    }
    if (value === undefined) continue;
    if (CREDENTIAL_KEYS.has(key) && (value === "" || value === "__set__")) continue;
    setPath(next, key, value);
  }
  return next;
}

export async function writeConfigEntries(
  entries: Record<string, unknown>,
  configPath = getOmpConfigPath(),
): Promise<void> {
  const disk = readConfigYaml(configPath);
  const next = mergeConfigEntries(disk, entries);
  const yaml = dump(next, { lineWidth: -1, noRefs: true });

  const dir = dirname(configPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const persist = () => {
    if (existsSync(configPath)) {
      copyFileSync(configPath, `${configPath}.bak-${Date.now()}`);
    }
    const tmp = `${configPath}.tmp-${process.pid}`;
    writeFileSync(tmp, yaml, { mode: 0o600 });
    renameSync(tmp, configPath);
  };

  if (!existsSync(configPath)) {
    persist();
    return;
  }
  const release = await lock(configPath, {
    realpath: false,
    retries: { retries: 5, factor: 1.5, minTimeout: 200, maxTimeout: 2000 },
  });
  try {
    persist();
  } finally {
    await release().catch(() => {});
  }
}
