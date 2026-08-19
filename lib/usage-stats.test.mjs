import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { collectUsageStats, invalidateUsageCache } = await jiti.import("./usage-stats.ts");

// ── helpers ────────────────────────────────────────────────────────────────

function assistantLine(opts = {}) {
  const ts = opts.timestamp ?? Date.now();
  const model = opts.model ?? "anthropic/claude-sonnet-4-20250514";
  const input = opts.input ?? 1000;
  const output = opts.output ?? 500;
  const cacheRead = opts.cacheRead ?? 0;
  const cacheWrite = opts.cacheWrite ?? 0;
  const costTotal = opts.costTotal ?? 0.005;
  return JSON.stringify({
    type: "message",
    id: "msg-" + Math.random().toString(36).slice(2, 8),
    timestamp: new Date(ts).toISOString(),
    message: {
      role: "assistant",
      model,
      content: [{ type: "text", text: "Hi" }],
      timestamp: ts,
      usage: {
        input,
        output,
        cacheRead,
        cacheWrite,
        cost: { input: costTotal * 0.7, output: costTotal * 0.3, cacheRead: 0, cacheWrite: 0, total: costTotal },
      },
    },
  });
}

function userLine() {
  return JSON.stringify({
    type: "message",
    id: "user-" + Math.random().toString(36).slice(2, 8),
    timestamp: new Date().toISOString(),
    message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() },
  });
}

function sessionHeader() {
  return JSON.stringify({ type: "session", id: "sess-" + Math.random().toString(36).slice(2, 8), timestamp: new Date().toISOString(), cwd: "/tmp/test" });
}

function makeSessions(files) {
  // files: { "<dirName>/<fileName>": string[] } — lines per jsonl
  const root = mkdtempSync(join(tmpdir(), "omp-usage-test-"));
  for (const [rel, lines] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, lines.join("\n"), "utf8");
  }
  return root;
}

function setMtime(path, ms) {
  const s = statSync(path);
  utimesSync(path, new Date(ms), new Date(ms));
}

// ── tests ──────────────────────────────────────────────────────────────────

test("aggregates tokens, cost, requests, sessions across files", () => {
  const today = Date.now();
  const root = makeSessions({
    "cwd-a/sess1.jsonl": [
      sessionHeader(),
      userLine(),
      assistantLine({ timestamp: today, input: 100, output: 50, costTotal: 0.01 }),
      assistantLine({ timestamp: today, input: 200, output: 100, costTotal: 0.02 }),
    ],
    "cwd-a/sess2.jsonl": [
      sessionHeader(),
      assistantLine({ timestamp: today, input: 400, output: 200, costTotal: 0.03 }),
    ],
  });

  const stats = collectUsageStats(root);

  // tokens: (100+50)+(200+100)+(400+200) = 1050
  assert.equal(stats.totals.tokens, 1050);
  // cost: 0.01 + 0.02 + 0.03
  assert.equal(stats.totals.cost.toFixed(3), "0.060");
  assert.equal(stats.totals.requests, 3);
  assert.equal(stats.totals.sessions, 2);
});

test("groups by day using message timestamp and falls back to mtime", () => {
  const day1 = Date.now();
  const day2 = Date.now() - 86400000;
  const root = makeSessions({
    "cwd-a/sess1.jsonl": [
      sessionHeader(),
      assistantLine({ timestamp: day1, input: 100, output: 0, costTotal: 0.01 }),
    ],
    // No timestamp in message → uses file mtime
    "cwd-a/sess2.jsonl": [
      sessionHeader(),
      JSON.stringify({
        type: "message",
        id: "msg-mtime",
        timestamp: new Date(day2).toISOString(),
        message: {
          role: "assistant",
          model: "openai/gpt-4o",
          content: [{ type: "text", text: "hi" }],
          usage: { input: 50, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0.02 } },
        },
      }),
    ],
  });
  setMtime(join(root, "cwd-a", "sess2.jsonl"), day2);

  const stats = collectUsageStats(root);

  const day1Str = new Date(day1).toISOString().slice(0, 10);
  const day2Str = new Date(day2).toISOString().slice(0, 10);

  const byDayMap = Object.fromEntries(stats.byDay.map((d) => [d.day, d]));
  assert.equal(byDayMap[day1Str].tokens, 100);
  assert.equal(byDayMap[day2Str].tokens, 50);
});

test("groups by model and sorts by cost descending", () => {
  const today = Date.now();
  const root = makeSessions({
    "cwd-a/sess1.jsonl": [
      sessionHeader(),
      assistantLine({ timestamp: today, model: "anthropic/claude", input: 100, output: 0, costTotal: 0.01 }),
      assistantLine({ timestamp: today, model: "openai/gpt-4o", input: 100, output: 0, costTotal: 0.05 }),
      assistantLine({ timestamp: today, model: "anthropic/claude", input: 100, output: 0, costTotal: 0.02 }),
    ],
  });

  const stats = collectUsageStats(root);

  assert.equal(stats.byModel.length, 2);
  assert.equal(stats.byModel[0].model, "openai/gpt-4o"); // cost 0.05 > claude 0.03
  assert.equal(stats.byModel[0].cost.toFixed(2), "0.05");
  assert.equal(stats.byModel[1].model, "anthropic/claude");
  assert.equal(stats.byModel[1].cost.toFixed(2), "0.03");
  assert.equal(stats.byModel[1].requests, 2);
});

test("skips non-assistant messages, non-usage lines, and malformed lines", () => {
  const today = Date.now();
  const root = makeSessions({
    "cwd-a/sess1.jsonl": [
      sessionHeader(),
      userLine(),
      assistantLine({ timestamp: today, input: 100, output: 0, costTotal: 0.01 }),
      "not valid json at all",
      JSON.stringify({ type: "message", id: "x", message: { role: "user", content: "usage in text but not a key" } }),
      JSON.stringify({ type: "message", id: "y", message: { role: "assistant", content: [{ type: "text", text: "no usage here" }] } }),
    ],
  });

  const stats = collectUsageStats(root);
  assert.equal(stats.totals.requests, 1);
  assert.equal(stats.totals.tokens, 100);
});

test("treats missing model as unknown", () => {
  const today = Date.now();
  const root = makeSessions({
    "cwd-a/sess1.jsonl": [
      sessionHeader(),
      JSON.stringify({
        type: "message",
        id: "m1",
        timestamp: new Date(today).toISOString(),
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hi" }],
          timestamp: today,
          usage: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } },
        },
      }),
    ],
  });

  const stats = collectUsageStats(root);
  assert.equal(stats.byModel.length, 1);
  assert.equal(stats.byModel[0].model, "unknown");
});

test("returns 30-day ascending byDay with zeros for empty days", () => {
  const root = makeSessions({ "cwd-a/sess1.jsonl": [sessionHeader(), assistantLine()] });
  const stats = collectUsageStats(root);

  assert.equal(stats.byDay.length, 30);
  for (let i = 1; i < stats.byDay.length; i++) {
    assert.ok(stats.byDay[i].day > stats.byDay[i - 1].day);
  }
  // Only one day has data; the rest are zero.
  assert.equal(stats.byDay.filter((d) => d.requests > 0).length, 1);
});

test("empty sessions dir yields zeroed stats", () => {
  const root = mkdtempSync(join(tmpdir(), "omp-usage-empty-"));
  const stats = collectUsageStats(root);
  assert.equal(stats.totals.tokens, 0);
  assert.equal(stats.totals.requests, 0);
  assert.equal(stats.totals.sessions, 0);
  assert.equal(stats.byModel.length, 0);
  assert.equal(stats.byDay.length, 30);
});

test("cache returns identical object within TTL", () => {
  const root = makeSessions({ "cwd-a/sess1.jsonl": [sessionHeader(), assistantLine()] });
  invalidateUsageCache();
  const a = collectUsageStats(root);
  const b = collectUsageStats(root);
  assert.strictEqual(a, b);
});

test("invalidate busts cache", () => {
  const root = makeSessions({ "cwd-a/sess1.jsonl": [sessionHeader(), assistantLine()] });
  invalidateUsageCache();
  const a = collectUsageStats(root);
  invalidateUsageCache();
  const b = collectUsageStats(root);
  assert.notStrictEqual(a, b);
});