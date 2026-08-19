import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { DatabaseSync } from "node:sqlite";

const jiti = createJiti(import.meta.url);
const {
  listMemoryBanks,
  readBankMemory,
  readAllMemories,
} = await jiti.import("./memory-service.ts");

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const WORKING_DDL = `CREATE TABLE working_memory (
  id TEXT PRIMARY KEY, content TEXT, source TEXT, timestamp TEXT,
  importance REAL, recall_count INTEGER, scope TEXT, session_id TEXT, created_at TIMESTAMP
);`;
const EPISODIC_DDL = `CREATE TABLE episodic_memory (
  id TEXT PRIMARY KEY, content TEXT, source TEXT, timestamp TEXT, session_id TEXT
);`;
const FACTS_DDL = `CREATE TABLE facts (
  fact_id TEXT PRIMARY KEY, subject TEXT, predicate TEXT, object TEXT,
  confidence REAL, created_at TIMESTAMP
);`;

function createMemDb(dir, data) {
  const db = new DatabaseSync(join(dir, "mnemopi.db"));
  db.exec(WORKING_DDL);
  db.exec(EPISODIC_DDL);
  db.exec(FACTS_DDL);
  const insertW = db.prepare(
    "INSERT INTO working_memory VALUES (?,?,?,?,?,?,?,?,?)",
  );
  for (const w of data.working ?? []) {
    insertW.run(
      w.id, w.content, w.source, w.timestamp,
      w.importance, w.recall_count, w.scope, w.session_id, w.created_at,
    );
  }
  const insertE = db.prepare(
    "INSERT INTO episodic_memory (id, content, source, timestamp, session_id) VALUES (?,?,?,?,?)",
  );
  for (const e of data.episodic ?? []) {
    insertE.run(e.id, e.content, e.source, e.timestamp, e.session_id);
  }
  const insertF = db.prepare(
    "INSERT INTO facts (fact_id, subject, predicate, object, confidence, created_at) VALUES (?,?,?,?,?,?)",
  );
  for (const f of data.facts ?? []) {
    insertF.run(f.fact_id, f.subject, f.predicate, f.object, f.confidence, f.created_at);
  }
  db.close();
}

function makeTempBanksDir() {
  return mkdtempSync(join(tmpdir(), "omp-mem-test-"));
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

test("listMemoryBanks returns empty for nonexistent directory", () => {
  const banks = listMemoryBanks("/tmp/omp-mem-nonexistent-xyz-123");
  assert.deepEqual(banks, []);
});

test("listMemoryBanks returns empty for empty directory", () => {
  const dir = makeTempBanksDir();
  try {
    assert.deepEqual(listMemoryBanks(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listMemoryBanks skips files and only returns directories", () => {
  const dir = makeTempBanksDir();
  try {
    writeFileSync(join(dir, "readme.txt"), "hello");
    mkdirSync(join(dir, "proj-a-abc123"));
    createMemDb(join(dir, "proj-a-abc123"), { working: [], episodic: [], facts: [] });
    const banks = listMemoryBanks(dir);
    assert.equal(banks.length, 1);
    assert.equal(banks[0].bank, "proj-a-abc123");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("project name parsing strips trailing hash suffix", () => {
  const dir = makeTempBanksDir();
  try {
    mkdirSync(join(dir, "omp-test-2ahkdvwi8qxk1"));
    createMemDb(join(dir, "omp-test-2ahkdvwi8qxk1"), { working: [], episodic: [], facts: [] });
    const banks = listMemoryBanks(dir);
    assert.equal(banks[0].bank, "omp-test-2ahkdvwi8qxk1");
    assert.equal(banks[0].project, "omp-test");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("project name with multiple dashes strips only last hash", () => {
  const dir = makeTempBanksDir();
  try {
    mkdirSync(join(dir, "omp-todo-test-t2u9zpxspgi7"));
    createMemDb(join(dir, "omp-todo-test-t2u9zpxspgi7"), { working: [], episodic: [], facts: [] });
    const banks = listMemoryBanks(dir);
    assert.equal(banks[0].project, "omp-todo-test");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("project name without dash keeps full name", () => {
  const dir = makeTempBanksDir();
  try {
    mkdirSync(join(dir, "simpleproject"));
    createMemDb(join(dir, "simpleproject"), { working: [], episodic: [], facts: [] });
    const banks = listMemoryBanks(dir);
    assert.equal(banks[0].project, "simpleproject");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readBankMemory returns empty for missing file", () => {
  const result = readBankMemory("/tmp/omp-mem-no-such-db-xyz.db");
  assert.deepEqual(result, { working: [], factsCount: 0, episodicCount: 0 });
});

test("readBankMemory returns empty for corrupt database", () => {
  const dir = makeTempBanksDir();
  try {
    const dbPath = join(dir, "mnemopi.db");
    writeFileSync(dbPath, "not a valid sqlite database");
    const result = readBankMemory(dbPath);
    assert.deepEqual(result, { working: [], factsCount: 0, episodicCount: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readBankMemory returns empty when tables are missing", () => {
  const dir = makeTempBanksDir();
  try {
    const db = new DatabaseSync(join(dir, "mnemopi.db"));
    db.exec("CREATE TABLE unrelated (x INTEGER)");
    db.close();
    const result = readBankMemory(join(dir, "mnemopi.db"));
    assert.deepEqual(result, { working: [], factsCount: 0, episodicCount: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readBankMemory reads working, facts, and episodic counts", () => {
  const dir = makeTempBanksDir();
  try {
    createMemDb(dir, {
      working: [
        { id: "1", content: "memory 1", source: "src-a", timestamp: "2026-01-01", importance: 0.8, recall_count: 3, scope: "bank", session_id: "s1", created_at: "2026-01-01" },
        { id: "2", content: "memory 2", source: "src-b", timestamp: "2026-01-02", importance: 0.5, recall_count: 1, scope: "bank", session_id: "s2", created_at: "2026-01-02" },
      ],
      episodic: [
        { id: "e1", content: "episode 1", source: "src-a", timestamp: "2026-01-01", session_id: "s1" },
        { id: "e2", content: "episode 2", source: "src-c", timestamp: "2026-01-03", session_id: "s3" },
        { id: "e3", content: "episode 3", source: "src-a", timestamp: "2026-01-04", session_id: "s1" },
      ],
      facts: [
        { fact_id: "f1", subject: "a", predicate: "is", object: "b", confidence: 0.9, created_at: "2026-01-01" },
        { fact_id: "f2", subject: "c", predicate: "has", object: "d", confidence: 0.7, created_at: "2026-01-02" },
        { fact_id: "f3", subject: "e", predicate: "likes", object: "f", confidence: 0.95, created_at: "2026-01-03" },
        { fact_id: "f4", subject: "g", predicate: "owns", object: "h", confidence: 0.8, created_at: "2026-01-04" },
      ],
    });
    const result = readBankMemory(join(dir, "mnemopi.db"));
    assert.equal(result.working.length, 2);
    assert.equal(result.factsCount, 4);
    assert.equal(result.episodicCount, 3);
    assert.equal(result.working[0].id, "1");
    assert.equal(result.working[0].content, "memory 1");
    assert.equal(result.working[0].source, "src-a");
    assert.equal(result.working[0].importance, 0.8);
    assert.equal(result.working[0].recallCount, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readAllMemories aggregates multiple banks by project", () => {
  const dir = makeTempBanksDir();
  try {
    // Two banks for the same project
    mkdirSync(join(dir, "app-x-abc123"));
    createMemDb(join(dir, "app-x-abc123"), {
      working: [
        { id: "w1", content: "high importance", source: "src-1", timestamp: "2026-01-01", importance: 0.9, recall_count: 5, scope: "bank", session_id: "s1", created_at: "2026-01-01" },
        { id: "w2", content: "medium importance", source: "src-2", timestamp: "2026-01-02", importance: 0.5, recall_count: 2, scope: "bank", session_id: "s2", created_at: "2026-01-02" },
      ],
      episodic: [{ id: "e1", content: "ep1", source: "src-1", timestamp: "2026-01-01", session_id: "s1" }],
      facts: [
        { fact_id: "f1", subject: "a", predicate: "is", object: "b", confidence: 0.9, created_at: "2026-01-01" },
        { fact_id: "f2", subject: "c", predicate: "has", object: "d", confidence: 0.7, created_at: "2026-01-02" },
      ],
    });
    mkdirSync(join(dir, "app-x-def456"));
    createMemDb(join(dir, "app-x-def456"), {
      working: [
        { id: "w3", content: "low importance", source: "src-3", timestamp: "2026-01-03", importance: 0.3, recall_count: 0, scope: "bank", session_id: "s3", created_at: "2026-01-03" },
        { id: "w4", content: "highest importance", source: "src-1", timestamp: "2026-01-04", importance: 0.95, recall_count: 10, scope: "bank", session_id: "s4", created_at: "2026-01-04" },
      ],
      episodic: [
        { id: "e2", content: "ep2", source: "src-3", timestamp: "2026-01-03", session_id: "s3" },
        { id: "e3", content: "ep3", source: "src-1", timestamp: "2026-01-04", session_id: "s4" },
      ],
      facts: [{ fact_id: "f3", subject: "e", predicate: "likes", object: "f", confidence: 0.95, created_at: "2026-01-03" }],
    });
    // A different project
    mkdirSync(join(dir, "other-ghi789"));
    createMemDb(join(dir, "other-ghi789"), {
      working: [
        { id: "w5", content: "other memory", source: "src-4", timestamp: "2026-01-05", importance: 0.7, recall_count: 1, scope: "bank", session_id: "s5", created_at: "2026-01-05" },
      ],
      episodic: [],
      facts: [{ fact_id: "f4", subject: "g", predicate: "owns", object: "h", confidence: 0.8, created_at: "2026-01-05" }],
    });

    const groups = readAllMemories(dir);
    assert.equal(groups.length, 2);

    // Groups sorted by project name (app-x < other)
    const appX = groups[0];
    assert.equal(appX.project, "app-x");
    assert.equal(appX.banks.length, 2);
    assert.equal(appX.working.length, 4);
    assert.equal(appX.factsCount, 3);
    assert.equal(appX.episodicCount, 3);
    // Working sorted by importance descending
    assert.equal(appX.working[0].importance, 0.95);
    assert.equal(appX.working[0].id, "w4");
    assert.equal(appX.working[1].importance, 0.9);
    assert.equal(appX.working[2].importance, 0.5);
    assert.equal(appX.working[3].importance, 0.3);

    const other = groups[1];
    assert.equal(other.project, "other");
    assert.equal(other.banks.length, 1);
    assert.equal(other.working.length, 1);
    assert.equal(other.factsCount, 1);
    assert.equal(other.episodicCount, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readAllMemories handles corrupt bank alongside valid banks", () => {
  const dir = makeTempBanksDir();
  try {
    mkdirSync(join(dir, "good-abc123"));
    createMemDb(join(dir, "good-abc123"), {
      working: [
        { id: "w1", content: "good memory", source: "src", timestamp: "2026-01-01", importance: 0.8, recall_count: 1, scope: "bank", session_id: "s1", created_at: "2026-01-01" },
      ],
      episodic: [],
      facts: [{ fact_id: "f1", subject: "a", predicate: "is", object: "b", confidence: 0.9, created_at: "2026-01-01" }],
    });
    mkdirSync(join(dir, "bad-xyz789"));
    writeFileSync(join(dir, "bad-xyz789", "mnemopi.db"), "garbage");

    const groups = readAllMemories(dir);
    // good and bad should both appear as banks, but bad contributes 0
    assert.equal(groups.length, 2);
    const good = groups.find((g) => g.project === "good");
    assert.ok(good);
    assert.equal(good.working.length, 1);
    assert.equal(good.factsCount, 1);
    const bad = groups.find((g) => g.project === "bad");
    assert.ok(bad);
    assert.equal(bad.working.length, 0);
    assert.equal(bad.factsCount, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readAllMemories handles bank with missing tables", () => {
  const dir = makeTempBanksDir();
  try {
    mkdirSync(join(dir, "partial-abc123"));
    const db = new DatabaseSync(join(dir, "partial-abc123", "mnemopi.db"));
    // Only create working_memory, no facts or episodic_memory
    db.exec(WORKING_DDL);
    const insertW = db.prepare(
      "INSERT INTO working_memory VALUES (?,?,?,?,?,?,?,?,?)",
    );
    insertW.run("w1", "partial content", "src", "2026-01-01", 0.6, 2, "bank", "s1", "2026-01-01");
    db.close();

    const groups = readAllMemories(dir);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].working.length, 1);
    assert.equal(groups[0].factsCount, 0);
    assert.equal(groups[0].episodicCount, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});