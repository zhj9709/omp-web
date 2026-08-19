import type { Dirent } from "node:fs";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface MemoryBank {
  /** bank directory name (includes hash suffix) */
  bank: string;
  /** project name (hash suffix stripped) */
  project: string;
  /** full path to mnemopi.db */
  path: string;
}

export interface WorkingMemoryEntry {
  id: string;
  content: string;
  source: string | null;
  timestamp: string | null;
  importance: number | null;
  recallCount: number | null;
  scope: string | null;
  sessionId: string | null;
  createdAt: string | null;
}

export interface BankMemory {
  working: WorkingMemoryEntry[];
  factsCount: number;
  episodicCount: number;
}

export interface ProjectMemory {
  project: string;
  banks: string[];
  working: WorkingMemoryEntry[];
  factsCount: number;
  episodicCount: number;
}

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

export function getMemoriesBanksDir(): string {
  return join(homedir(), ".omp", "agent", "memories", "mnemopi", "banks");
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function countRows(db: DatabaseSync, table: string): number {
  try {
    const row = db
      .prepare(`SELECT COUNT(*) AS c FROM "${table}"`)
      .get() as { c: number } | undefined;
    return Number(row?.c ?? 0);
  } catch {
    return 0;
  }
}

function readWorking(db: DatabaseSync): WorkingMemoryEntry[] {
  try {
    const rows = db
      .prepare(
        `SELECT id, content, source, timestamp, importance, recall_count, scope, session_id, created_at FROM working_memory`,
      )
      .all() as Array<{
        id: string;
        content: string;
        source: string | null;
        timestamp: string | null;
        importance: number | null;
        recall_count: number | null;
        scope: string | null;
        session_id: string | null;
        created_at: string | null;
      }>;
    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      source: r.source,
      timestamp: r.timestamp,
      importance: r.importance,
      recallCount: r.recall_count,
      scope: r.scope,
      sessionId: r.session_id,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Scan the banks directory and return bank metadata.
 * @param banksDir optional override (for testing)
 */
export function listMemoryBanks(
  banksDir: string = getMemoriesBanksDir(),
): MemoryBank[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(banksDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const result: MemoryBank[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const idx = e.name.lastIndexOf("-");
    const project = idx >= 0 ? e.name.slice(0, idx) : e.name;
    result.push({ bank: e.name, project, path: join(banksDir, e.name, "mnemopi.db") });
  }
  result.sort((a, b) => a.bank.localeCompare(b.bank));
  return result;
}

/**
 * Read memory from a single bank's mnemopi.db file.
 * Missing file, corrupt DB, or missing tables all return empty results.
 */
export function readBankMemory(dbPath: string): BankMemory {
  const empty: BankMemory = { working: [], factsCount: 0, episodicCount: 0 };
  if (!existsSync(dbPath)) return empty;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    return {
      working: readWorking(db),
      factsCount: countRows(db, "facts"),
      episodicCount: countRows(db, "episodic_memory"),
    };
  } catch {
    return empty;
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Aggregate all banks into project groups, sorted by project name.
 * Working entries within each project are sorted by importance descending.
 * @param banksDir optional override (for testing)
 */
export function readAllMemories(
  banksDir: string = getMemoriesBanksDir(),
): ProjectMemory[] {
  const banks = listMemoryBanks(banksDir);
  const byProject = new Map<string, ProjectMemory>();
  for (const bank of banks) {
    const mem = readBankMemory(bank.path);
    const existing = byProject.get(bank.project);
    if (existing) {
      existing.banks.push(bank.bank);
      existing.working.push(...mem.working);
      existing.factsCount += mem.factsCount;
      existing.episodicCount += mem.episodicCount;
    } else {
      byProject.set(bank.project, {
        project: bank.project,
        banks: [bank.bank],
        working: [...mem.working],
        factsCount: mem.factsCount,
        episodicCount: mem.episodicCount,
      });
    }
  }
  const groups = [...byProject.values()];
  for (const g of groups) {
    g.working.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
  }
  groups.sort((a, b) => a.project.localeCompare(b.project));
  return groups;
}