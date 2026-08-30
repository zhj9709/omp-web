/**
 * Browser-persisted chat column width, as a percentage of the default 820px
 * content column. Web-local (localStorage), unlike the Settings modal's omp
 * config.yml entries — it only affects how omp-web renders the chat column
 * and applies immediately, without going through /api/config.
 */
import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "omp-web:chat-column-width-pct";
export const CHAT_COLUMN_BASE_WIDTH = 820;
export const CHAT_WIDTH_MIN_PCT = 50;
export const CHAT_WIDTH_MAX_PCT = 150;
export const CHAT_WIDTH_DEFAULT_PCT = 100;

const listeners = new Set<() => void>();
let cachedPct: number | null = null;

export function clampChatWidthPct(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return CHAT_WIDTH_DEFAULT_PCT;
  return Math.min(CHAT_WIDTH_MAX_PCT, Math.max(CHAT_WIDTH_MIN_PCT, n));
}

export function readChatWidthPct(): number {
  if (typeof window === "undefined") return CHAT_WIDTH_DEFAULT_PCT;
  if (cachedPct !== null) return cachedPct;
  try {
    cachedPct = clampChatWidthPct(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    cachedPct = CHAT_WIDTH_DEFAULT_PCT;
  }
  return cachedPct;
}

export function writeChatWidthPct(pct: number): void {
  const next = clampChatWidthPct(pct);
  cachedPct = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** [widthPct, setWidthPct] — re-renders consumers whenever the preference changes. */
export function useChatWidthPct(): [number, (pct: number) => void] {
  const pct = useSyncExternalStore(subscribe, readChatWidthPct, () => CHAT_WIDTH_DEFAULT_PCT);
  const setPct = useCallback((value: number) => writeChatWidthPct(value), []);
  return [pct, setPct];
}

export function chatColumnWidth(pct: number): number {
  return Math.round((CHAT_COLUMN_BASE_WIDTH * clampChatWidthPct(pct)) / 100);
}
