/**
 * Client-side record of projects the user closed from the workspace picker.
 *
 * The project list is derived from session files on disk, so "closing" a
 * project cannot delete anything — it just hides its entry from the picker.
 * Closed keys persist in localStorage; opening a custom path inside a closed
 * project re-opens it (see SessionSidebar).
 */
const STORAGE_KEY = "omp-web.closed-projects";

export function loadClosedProjectKeys(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((k): k is string => typeof k === "string");
  } catch {
    return [];
  }
}

export function saveClosedProjectKeys(keys: Iterable<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // Quota/disabled storage — closing stays session-only.
  }
}

export function addClosedProjectKey(keys: Set<string>, key: string): Set<string> {
  if (keys.has(key)) return keys;
  const next = new Set(keys);
  next.add(key);
  saveClosedProjectKeys(next);
  return next;
}

export function removeClosedProjectKey(keys: Set<string>, key: string): Set<string> {
  if (!keys.has(key)) return keys;
  const next = new Set(keys);
  next.delete(key);
  saveClosedProjectKeys(next);
  return next;
}
