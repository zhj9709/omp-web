import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ============================================================================
// Types
// ============================================================================

export interface UsageDay {
  day: string;
  tokens: number;
  cost: number;
  requests: number;
}

export interface UsageModel {
  model: string;
  tokens: number;
  cost: number;
  requests: number;
}

export interface UsageTotals {
  tokens: number;
  cost: number;
  requests: number;
  sessions: number;
}

export interface UsageStats {
  byDay: UsageDay[];
  byModel: UsageModel[];
  totals: UsageTotals;
}

// ============================================================================
// Constants
// ============================================================================

const SESSIONS_DIR = join(homedir(), ".omp", "agent", "sessions");
const CACHE_TTL_MS = 60_000;

// ============================================================================
// Cache
// ============================================================================

interface CacheEntry {
  key: string;
  data: UsageStats;
  ts: number;
}

let _cache: CacheEntry | null = null;

export function invalidateUsageCache(): void {
  _cache = null;
}

// ============================================================================
// Raw collection
// ============================================================================

interface RawUsage {
  day: string;
  model: string;
  tokens: number;
  cost: number;
  file: string;
}

function dayFromTimestamp(ts: number | undefined, mtimeMs: number): string {
  const ms = (typeof ts === "number" && ts > 0) ? ts : mtimeMs;
  return new Date(ms).toISOString().slice(0, 10);
}

function collectRawUsage(sessionsDir: string): RawUsage[] {
  const raw: RawUsage[] = [];

  let cwdDirs: string[];
  try {
    cwdDirs = readdirSync(sessionsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return raw;
  }

  for (const dirName of cwdDirs) {
    const dirPath = join(sessionsDir, dirName);
    let files: string[];
    try {
      files = readdirSync(dirPath);
    } catch {
      continue;
    }

    for (const name of files) {
      if (!name.endsWith(".jsonl")) continue;
      const filePath = join(dirPath, name);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(filePath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;

      const mtimeMs = stat.mtimeMs;

      let content: string;
      try {
        content = readFileSync(filePath, "utf8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      for (const line of lines) {
        if (!line.includes('"usage"')) continue;
        const trimmed = line.trim();
        if (!trimmed) continue;

        let entry: Record<string, unknown>;
        try {
          entry = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          continue;
        }

        if (entry.type !== "message") continue;
        const msg = entry.message as Record<string, unknown> | undefined;
        if (!msg || msg.role !== "assistant") continue;

        const usage = msg.usage as Record<string, unknown> | undefined;
        if (!usage) continue;

        const input = typeof usage.input === "number" ? usage.input : 0;
        const output = typeof usage.output === "number" ? usage.output : 0;
        const cacheRead = typeof usage.cacheRead === "number" ? usage.cacheRead : 0;
        const cacheWrite = typeof usage.cacheWrite === "number" ? usage.cacheWrite : 0;

        const costObj = usage.cost as Record<string, unknown> | undefined;
        const cost = costObj && typeof costObj.total === "number" ? costObj.total : 0;

        const totalTokens = input + output + cacheRead + cacheWrite;

        const ts = typeof msg.timestamp === "number" ? msg.timestamp : undefined;
        const day = dayFromTimestamp(ts, mtimeMs);

        const model = typeof msg.model === "string" && msg.model ? msg.model : "unknown";

        raw.push({ day, model, tokens: totalTokens, cost, file: filePath });
      }
    }
  }

  return raw;
}

// ============================================================================
// Aggregation
// ============================================================================

function daysInRange(n: number): string[] {
  const result: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    result.push(d.toISOString().slice(0, 10));
  }
  return result;
}

function aggregate(raw: RawUsage[]): UsageStats {
  // --- byDay
  const dayMap = new Map<string, { tokens: number; cost: number; requests: number }>();
  for (const r of raw) {
    const cur = dayMap.get(r.day) ?? { tokens: 0, cost: 0, requests: 0 };
    cur.tokens += r.tokens;
    cur.cost += r.cost;
    cur.requests += 1;
    dayMap.set(r.day, cur);
  }

  const last30Days = daysInRange(30);
  const byDay: UsageDay[] = last30Days.map((day) => {
    const d = dayMap.get(day);
    return {
      day,
      tokens: d ? d.tokens : 0,
      cost: d ? d.cost : 0,
      requests: d ? d.requests : 0,
    };
  });

  // --- byModel
  const modelMap = new Map<string, { tokens: number; cost: number; requests: number }>();
  for (const r of raw) {
    const cur = modelMap.get(r.model) ?? { tokens: 0, cost: 0, requests: 0 };
    cur.tokens += r.tokens;
    cur.cost += r.cost;
    cur.requests += 1;
    modelMap.set(r.model, cur);
  }

  const byModel: UsageModel[] = [...modelMap.entries()]
    .map(([model, v]) => ({ model, tokens: v.tokens, cost: v.cost, requests: v.requests }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 12);

  // --- totals
  const uniqueFiles = new Set(raw.map((r) => r.file));
  const totals: UsageTotals = {
    tokens: 0,
    cost: 0,
    requests: raw.length,
    sessions: uniqueFiles.size,
  };
  for (const r of raw) {
    totals.tokens += r.tokens;
    totals.cost += r.cost;
  }

  return { byDay, byModel, totals };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Collects usage statistics from all persisted session JSONL files.
 * Results are cached in memory for 60 seconds. Pass `sessionsDir` to
 * override the default `~/.omp/agent/sessions` location (used by tests).
 */
export function collectUsageStats(sessionsDir: string = SESSIONS_DIR): UsageStats {
  if (_cache && _cache.key === sessionsDir && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return _cache.data;
  }

  const result = aggregate(collectRawUsage(sessionsDir));
  _cache = { key: sessionsDir, data: result, ts: Date.now() };
  return result;
}