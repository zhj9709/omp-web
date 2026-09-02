import { promises as fs } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface PinnedProject {
  /** Stable identity from server (projectKey when available, else projectRoot). */
  key: string;
  /** Display path used for filesystem operations and re-pinning via cwd picker. */
  root: string;
  /** Last time the user opened this project (ISO string). For sort and prune heuristics. */
  lastOpenedAt: string;
}

interface PinnedProjectsFile {
  version: 1;
  projects: PinnedProject[];
}

const FILE_VERSION = 1 as const;
const WEB_DIR_NAME = ".omp";
const WEB_PREFERENCES_FILE = "preferences.json";
/** Server key under which pinned projects are stored. */
export const PINNED_PROJECTS_KEY = "pinnedProjects";

function pinnedFilePath(): string {
  return join(homedir(), WEB_DIR_NAME, "web", WEB_PREFERENCES_FILE);
}

/** Empty list sentinel — returned when no file exists yet. */
const EMPTY: PinnedProject[] = [];

export async function readPinnedProjects(): Promise<PinnedProject[]> {
  try {
    const raw = await fs.readFile(pinnedFilePath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<PinnedProjectsFile>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.projects)) {
      return [...EMPTY];
    }
    return parsed.projects
      .filter((p): p is PinnedProject =>
        p !== null
        && typeof p === "object"
        && typeof p.key === "string"
        && typeof p.root === "string"
        && typeof p.lastOpenedAt === "string",
      );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [...EMPTY];
    console.error("[omp-web] failed to read pinned projects:", err);
    return [...EMPTY];
  }
}

export async function writePinnedProjects(projects: PinnedProject[]): Promise<void> {
  const path = pinnedFilePath();
  await fs.mkdir(join(homedir(), WEB_DIR_NAME, "web"), { recursive: true });
  const payload: PinnedProjectsFile = { version: FILE_VERSION, projects };
  // Atomic-ish write: temp + rename, mode 0600 for the final file.
  const tmp = path + ".tmp-" + Math.random().toString(36).slice(2);
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
  await fs.rename(tmp, path);
  await fs.chmod(path, 0o600).catch(() => {});
}

/**
 * Upsert a single project: bump lastOpenedAt, return the new full list. The
 * caller decides whether to persist it (used by both the explicit "+ 添加项目"
 * flow and the auto-pin on first visit).
 */
export function upsertPinnedProject(
  list: PinnedProject[],
  key: string,
  root: string,
  now: string = new Date().toISOString(),
): PinnedProject[] {
  const filtered = list.filter((p) => p.key !== key);
  filtered.push({ key, root, lastOpenedAt: now });
  return filtered;
}

export function removePinnedProject(list: PinnedProject[], key: string): PinnedProject[] {
  return list.filter((p) => p.key !== key);
}