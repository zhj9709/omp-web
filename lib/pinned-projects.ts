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
  /** Workspace keys the user closed — hidden from the sidebar, sessions kept on disk. */
  closedProjects?: string[];
  /**
   * User-arranged sidebar order (drag & drop + "newly opened goes first").
   * Keys not listed sort after all listed ones by recent activity.
   */
  projectOrder?: string[];
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

interface PrefsSnapshot {
  projects: PinnedProject[];
  closedProjects: string[];
  projectOrder: string[];
}

async function readPrefsFile(): Promise<PrefsSnapshot> {
  try {
    const raw = await fs.readFile(pinnedFilePath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<PinnedProjectsFile>;
    const projects = !parsed || typeof parsed !== "object" || !Array.isArray(parsed.projects)
      ? [...EMPTY]
      : parsed.projects.filter((p): p is PinnedProject =>
        p !== null
        && typeof p === "object"
        && typeof p.key === "string"
        && typeof p.root === "string"
        && typeof p.lastOpenedAt === "string",
      );
    const closedProjects = Array.isArray(parsed?.closedProjects)
      ? parsed.closedProjects.filter((k): k is string => typeof k === "string")
      : [];
    const projectOrder = Array.isArray(parsed?.projectOrder)
      ? parsed.projectOrder.filter((k): k is string => typeof k === "string")
      : [];
    return { projects, closedProjects, projectOrder };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { projects: [...EMPTY], closedProjects: [], projectOrder: [] };
    }
    console.error("[omp-web] failed to read pinned projects:", err);
    return { projects: [...EMPTY], closedProjects: [], projectOrder: [] };
  }
}

// In-process write mutex: every POST handler does a full-file
// read-modify-write, so concurrent requests (e.g. pin + reorder fired from one
// click) must be serialized or the later write would resurrect stale sibling
// fields and drop the earlier one.
let writeChain: Promise<unknown> = Promise.resolve();

/** Read-modify-write: every field lives in the same file and must survive. */
async function writePrefsFile(mutate: (prev: PrefsSnapshot) => PrefsSnapshot): Promise<PrefsSnapshot> {
  const run = writeChain.then(() => writePrefsFileInner(mutate));
  writeChain = run.catch(() => { /* keep the chain alive for later writers */ });
  return run;
}

async function writePrefsFileInner(mutate: (prev: PrefsSnapshot) => PrefsSnapshot): Promise<PrefsSnapshot> {
  const prev = await readPrefsFile();
  const next = mutate(prev);
  const path = pinnedFilePath();
  await fs.mkdir(join(homedir(), WEB_DIR_NAME, "web"), { recursive: true });
  const payload: PinnedProjectsFile = {
    version: FILE_VERSION,
    projects: next.projects,
    closedProjects: next.closedProjects,
    projectOrder: next.projectOrder,
  };
  // Atomic-ish write: temp + rename, mode 0600 for the final file.
  const tmp = path + ".tmp-" + Math.random().toString(36).slice(2);
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
  await fs.rename(tmp, path);
  await fs.chmod(path, 0o600).catch(() => {});
  return next;
}

export async function readPinnedProjects(): Promise<PinnedProject[]> {
  return (await readPrefsFile()).projects;
}

export async function readClosedProjects(): Promise<string[]> {
  return (await readPrefsFile()).closedProjects;
}

export async function readProjectOrder(): Promise<string[]> {
  return (await readPrefsFile()).projectOrder;
}

export async function writePinnedProjects(projects: PinnedProject[]): Promise<void> {
  await writePrefsFile((prev) => ({ ...prev, projects }));
}

export async function writeClosedProjects(closedProjects: string[]): Promise<void> {
  await writePrefsFile((prev) => ({ ...prev, closedProjects }));
}

export async function writeProjectOrder(projectOrder: string[]): Promise<void> {
  await writePrefsFile((prev) => ({ ...prev, projectOrder }));
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
