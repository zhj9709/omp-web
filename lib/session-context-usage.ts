/**
 * File-side context usage estimation for cold sessions.
 *
 * contextUsage normally comes from a live omp process (`get_state`), but the
 * wrapper only exists once a turn has run in this server session. For a
 * session picked from the sidebar (never started, or idle-reclaimed) the state
 * route has no live source — this module reconstructs the last known context
 * size directly from the session .jsonl file instead.
 *
 * omp records `contextSnapshot.promptTokens` on assistant messages, so the
 * last non-empty one is exactly what omp would report. Older files without a
 * snapshot fall back to usage.input + cacheRead + cacheWrite.
 *
 * Reading strategy: session files are append-only and dominated by tool output
 * (multi-MB is common), while the only entry we need is the last assistant
 * message. A bounded tail is read first, and the window is widened only when
 * the tail turned out to contain no usable assistant entry. Every assistant
 * entry carries its own provider/model — `model_change` records sit at the top
 * of the file and are essentially never in the tail — so the model is taken
 * from the same entry that produced the token count.
 */
import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import type { ContextUsage } from "./pi-types";
import { getOmpModelList } from "./omp-models";
import { loadModelsDevCatalog } from "./model-catalog";

export interface ModelRef {
  provider: string;
  modelId: string;
}

/** Context window resolver — injected in tests, defaults to local + catalog. */
export type ContextWindowResolver = (model: ModelRef) => Promise<number | null>;

export interface ColdContextUsageOptions {
  resolveWindow?: ContextWindowResolver;
  /** Deadline for the window lookup. Overridable for tests only. */
  timeoutMs?: number;
}

// Progressive tail sizes: the common case hits 128 KB; the second pass covers
// a huge trailing tool result; the last pass is the old whole-file behavior,
// only reached by genuinely pathological files (and capped for safety).
const TAIL_BYTES_SMALL = 128 * 1024;
const TAIL_BYTES_LARGE = 4 * 1024 * 1024;
const TAIL_BYTES_MAX = 64 * 1024 * 1024;

// This runs while the UI is loading a session, and the number is decorative —
// it must never stall the load. Resolving a window can mean spawning the omp
// CLI (~4 s cold) plus a multi-MB models.dev fetch that times out at 15 s, so
// the lookup gets a hard deadline: past it we report nothing and let the
// background work warm the caches for the next request.
const WINDOW_DEADLINE_MS = 2_000;
const WINDOW_CACHE_TTL_MS = 10 * 60 * 1000;
const WINDOW_CACHE_MAX = 128;

const RESULT_CACHE_MAX = 64;
const resultCache = new Map<string, ContextUsage | null>();
const windowCache = new Map<string, { value: number | null; expiresAt: number }>();

/** Read the last `maxBytes` of a file, dropping a leading partial line. */
function readTailText(filePath: string, maxBytes: number): string {
  const fd = openSync(filePath, "r");
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(maxBytes, size);
    if (length === 0) return "";
    const buffer = Buffer.allocUnsafe(length);
    const bytesRead = readSync(fd, buffer, 0, length, size - length);
    const text = buffer.toString("utf8", 0, bytesRead);
    if (length === size) return text;
    // We started mid-file: the first line is truncated, so drop it.
    const firstBreak = text.indexOf("\n");
    return firstBreak === -1 ? "" : text.slice(firstBreak + 1);
  } finally {
    closeSync(fd);
  }
}

export interface TailScan {
  tokens: number | null;
  /** Model that was active for `tokens` — not simply the newest model seen. */
  model: ModelRef | null;
}

/**
 * Scan jsonl text (any slice of it) for the last assistant token count and the
 * model that produced it. Pure and synchronous so it can be unit-tested.
 */
export function scanSessionEntries(text: string): TailScan {
  let lastModel: ModelRef | null = null;
  let modelAtTokens: ModelRef | null = null;
  let tokens: number | null = null;

  for (const line of text.split("\n")) {
    if (!line.includes('"message"') && !line.includes('"model_change"')) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (entry.type === "model_change") {
      const modelStr = typeof entry.model === "string" ? entry.model : undefined;
      if (modelStr) {
        const slash = modelStr.indexOf("/");
        if (slash > 0) {
          lastModel = { provider: modelStr.slice(0, slash), modelId: modelStr.slice(slash + 1) };
        }
      } else if (typeof entry.provider === "string" && typeof entry.modelId === "string") {
        lastModel = { provider: entry.provider, modelId: entry.modelId };
      }
      continue;
    }

    if (entry.type !== "message") continue;
    const msg = entry.message as Record<string, unknown> | undefined;
    if (!msg || msg.role !== "assistant") continue;

    if (typeof msg.provider === "string" && typeof msg.model === "string" && msg.model) {
      lastModel = { provider: msg.provider, modelId: msg.model };
    }

    const snapshot = msg.contextSnapshot as Record<string, unknown> | undefined;
    if (snapshot && typeof snapshot.promptTokens === "number") {
      tokens = snapshot.promptTokens;
      // Pair the count with the model in effect at this entry: a later
      // model_change (user switched model and stopped) belongs to a context
      // this number was never measured against.
      modelAtTokens = lastModel;
      continue;
    }

    const usage = msg.usage as Record<string, unknown> | undefined;
    if (usage) {
      const input = typeof usage.input === "number" ? usage.input : 0;
      const cacheRead = typeof usage.cacheRead === "number" ? usage.cacheRead : 0;
      const cacheWrite = typeof usage.cacheWrite === "number" ? usage.cacheWrite : 0;
      const sum = input + cacheRead + cacheWrite;
      // Aborted/errored turns record all-zero usage; keep the last real value.
      if (sum > 0) {
        tokens = sum;
        modelAtTokens = lastModel;
      }
    }
  }

  return { tokens, model: modelAtTokens ?? lastModel };
}

function normalizeModelKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9.]/g, "");
}

/**
 * Context window for a model: OMP's own model storage first (authoritative,
 * offline), then models.dev for providers OMP has no metadata for (e.g.
 * custom models.yaml providers).
 */
export const resolveContextWindow: ContextWindowResolver = async (model) => {
  try {
    const local = (await getOmpModelList()).find(
      (m) => m.provider === model.provider && m.id === model.modelId && m.contextWindow,
    );
    if (local?.contextWindow) return local.contextWindow;
  } catch {
    // OMP model storage unavailable — fall through to the catalog.
  }

  try {
    const entries = await loadModelsDevCatalog();
    const target = normalizeModelKey(model.modelId);
    if (!target) return null;
    const exact = entries.find(
      (e) => e.contextWindow && normalizeModelKey(e.id) === target,
    );
    if (exact?.contextWindow) return exact.contextWindow;
    const suffix = entries.find(
      (e) => e.contextWindow && normalizeModelKey(e.id).endsWith(target),
    );
    return suffix?.contextWindow ?? null;
  } catch {
    return null;
  }
};

function rememberWindow(key: string, value: number | null): void {
  windowCache.set(key, { value, expiresAt: Date.now() + WINDOW_CACHE_TTL_MS });
  while (windowCache.size > WINDOW_CACHE_MAX) {
    const oldest = windowCache.keys().next().value;
    if (oldest === undefined) break;
    windowCache.delete(oldest);
  }
}

function remember(key: string, value: ContextUsage | null): ContextUsage | null {
  resultCache.set(key, value);
  while (resultCache.size > RESULT_CACHE_MAX) {
    const oldest = resultCache.keys().next().value;
    if (oldest === undefined) break;
    resultCache.delete(oldest);
  }
  return value;
}

/**
 * Race a lookup against a deadline. The losing promise is left running on
 * purpose: a slow `omp models` CLI or models.dev fetch still populates the
 * caches those helpers share with the rest of the app.
 */
function withDeadline(
  promise: Promise<number | null>,
  ms: number,
): Promise<{ value: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ value: null, timedOut: true });
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ value, timedOut: false });
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ value: null, timedOut: false });
      },
    );
  });
}

async function resolveWindowCached(
  model: ModelRef,
  resolveWindow: ContextWindowResolver,
  timeoutMs: number,
): Promise<{ value: number | null; timedOut: boolean }> {
  const key = `${model.provider}/${model.modelId}`;
  const hit = windowCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return { value: hit.value, timedOut: false };

  const result = await withDeadline(resolveWindow(model), timeoutMs);
  // A timed-out lookup is not a fact about the model, so it is not memoized.
  if (!result.timedOut) rememberWindow(key, result.value);
  return result;
}

/**
 * Last known context usage for a session with no live omp process, or null
 * when the file has no usable assistant entry or the model's context window
 * cannot be resolved (a null window would leave the UI with a bare token
 * count it cannot render as a percentage).
 */
export async function computeColdContextUsage(
  filePath: string,
  options: ColdContextUsageOptions = {},
): Promise<ContextUsage | null> {
  const resolveWindow = options.resolveWindow ?? resolveContextWindow;
  const timeoutMs = options.timeoutMs ?? WINDOW_DEADLINE_MS;

  let cacheKey: string;
  try {
    const stat = statSync(filePath);
    // Session files are append-only: size + mtime is enough to reuse a result
    // when the user flips between sessions without new turns.
    cacheKey = `${filePath}:${stat.size}:${stat.mtimeMs}`;
    const cached = resultCache.get(cacheKey);
    if (cached !== undefined) return cached;
  } catch {
    return null;
  }

  let scan = scanSessionEntries(readTailText(filePath, TAIL_BYTES_SMALL));
  if (scan.tokens === null || scan.model === null) {
    scan = scanSessionEntries(readTailText(filePath, TAIL_BYTES_LARGE));
  }
  if (scan.tokens === null || scan.model === null) {
    scan = scanSessionEntries(readTailText(filePath, TAIL_BYTES_MAX));
  }

  if (scan.tokens === null || !scan.model) return remember(cacheKey, null);

  const { value: contextWindow, timedOut } = await resolveWindowCached(
    scan.model,
    resolveWindow,
    timeoutMs,
  );
  // Never memoize a timeout: the next request should try again once the
  // background lookup has had a chance to warm things up.
  if (timedOut) return null;
  if (!contextWindow) return remember(cacheKey, null);

  return remember(cacheKey, {
    tokens: scan.tokens,
    contextWindow,
    percent: (scan.tokens / contextWindow) * 100,
  });
}
