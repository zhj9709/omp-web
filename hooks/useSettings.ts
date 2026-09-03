"use client";

import { useEffect, useState } from "react";
import { SETTINGS_SCHEMA } from "@/lib/settings-schema";

type Values = Record<string, unknown> | null;

let cached: Values = null;
let inflight: Promise<Values> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((cb) => cb());
}

async function load(): Promise<Values> {
  if (cached !== null) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/config", { cache: "no-store" });
      const data = await res.json().catch(() => ({})) as { values?: Values };
      cached = data.values ?? {};
      return cached;
    } catch {
      cached = {};
      return cached;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Resolves when the shared /api/config cache has been populated. Use this
 * before issuing irreversible requests whose parameters depend on settings
 * (e.g. `expandCompaction`) so the first request already matches the
 * user's chosen view mode.
 */
export function ensureSettingsLoaded(): Promise<Values> {
  return load();
}

function readPath(obj: Values, dotted: string): unknown {
  if (!obj) return undefined;
  let cur: unknown = obj;
  for (const part of dotted.split(".")) {
    if (typeof cur !== "object" || cur === null || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function defaultFor(key: string): unknown {
  const def = SETTINGS_SCHEMA.find((s) => s.key === key);
  return def?.default;
}

/**
 * Read a single setting key. Returns `undefined` while the shared settings
 * cache has not yet been populated by the first /api/config fetch — callers
 * that need to make an irreversible choice (e.g. whether to ask the server
 * for the expanded pre-compaction transcript) should wait until the value is
 * defined. Subscribes to the shared cache; `refreshSettings()` invalidates
 * it (called by SettingsConfig after a successful save).
 */
export function useSetting<T = unknown>(key: string): T | undefined {
  const [snapshot, setSnapshot] = useState<Values>(cached);

  useEffect(() => {
    const tick = () => setSnapshot(cached);
    listeners.add(tick);
    if (cached === null) {
      void load().then(() => emit());
    } else {
      setSnapshot(cached);
    }
    return () => {
      listeners.delete(tick);
    };
  }, []);

  if (snapshot === null) return undefined;
  const value = readPath(snapshot, key);
  return (value === undefined ? defaultFor(key) : value) as T;
}

/**
 * Drop the in-memory settings cache and notify subscribers. Called after
 * SettingsConfig saves so live views (e.g. session loaders) pick up the new
 * value without a page reload.
 */
export function refreshSettings(): void {
  cached = null;
  inflight = null;
  void load().then(() => emit());
}
