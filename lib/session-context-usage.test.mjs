import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { computeColdContextUsage, scanSessionEntries } = await jiti.import("./session-context-usage.ts");

// Each test that resolves a window uses a distinct model id: the window cache
// is process-wide, so a shared id would leak results between tests.
function assistant(overrides = {}, model = "MiniMax-M3") {
  return JSON.stringify({
    type: "message",
    id: "m1",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "assistant", provider: "minimax-code-cn", model, ...overrides },
  });
}

function sessionFile(lines) {
  const dir = mkdtempSync(join(tmpdir(), "omp-ctx-"));
  const file = join(dir, "session.jsonl");
  writeFileSync(file, lines.join("\n") + "\n", "utf8");
  return file;
}

const RESOLVER = async () => 200_000;

test("reads the last assistant contextSnapshot", () => {
  const scan = scanSessionEntries([
    assistant({ contextSnapshot: { promptTokens: 1000 }, usage: { input: 10 } }),
    assistant({ contextSnapshot: { promptTokens: 42000 }, usage: { input: 10 } }),
  ].join("\n"));
  assert.equal(scan.tokens, 42000);
  assert.deepEqual(scan.model, { provider: "minimax-code-cn", modelId: "MiniMax-M3" });
});

test("falls back to usage sum when no snapshot exists", () => {
  const scan = scanSessionEntries(
    assistant({ usage: { input: 594, cacheRead: 169_494, cacheWrite: 0 } }),
  );
  assert.equal(scan.tokens, 170_088);
});

test("all-zero usage from an aborted turn keeps the previous value", () => {
  const scan = scanSessionEntries([
    assistant({ usage: { input: 500, cacheRead: 200, cacheWrite: 0 } }),
    assistant({ stopReason: "error", usage: { input: 0, cacheRead: 0, cacheWrite: 0 } }),
  ].join("\n"));
  assert.equal(scan.tokens, 700);
});

test("pairs tokens with the model active at that entry, not a later model_change", () => {
  const scan = scanSessionEntries([
    assistant({ contextSnapshot: { promptTokens: 5000 } }),
    JSON.stringify({ type: "model_change", provider: "openai", modelId: "gpt-5" }),
  ].join("\n"));
  assert.equal(scan.tokens, 5000);
  assert.deepEqual(scan.model, { provider: "minimax-code-cn", modelId: "MiniMax-M3" });
});

test("no assistant entry yields nothing", () => {
  const scan = scanSessionEntries([
    JSON.stringify({ type: "session", id: "s", cwd: "/tmp" }),
    JSON.stringify({ type: "message", message: { role: "user", content: "hi" } }),
  ].join("\n"));
  assert.equal(scan.tokens, null);
  assert.equal(scan.model, null);
});

test("skips non-jsonl noise and truncated lines", () => {
  const scan = scanSessionEntries([
    "not json at all",
    assistant({ contextSnapshot: { promptTokens: 1234 } }),
    '{"type":"message","message":{"role":"assistant","content":"trunca',
  ].join("\n"));
  assert.equal(scan.tokens, 1234);
});

test("computes usage from a file, reading only the tail", async () => {
  // A leading entry far larger than the 128 KB tail window must not win.
  const huge = assistant({ contextSnapshot: { promptTokens: 1 } }) + "x".repeat(200 * 1024);
  const file = sessionFile([
    JSON.stringify({ type: "session", id: "s", cwd: "/tmp" }),
    JSON.stringify({ type: "model_change", provider: "openai", modelId: "gpt-5" }),
    huge,
    assistant({ contextSnapshot: { promptTokens: 170_088 } }),
  ]);

  const usage = await computeColdContextUsage(file, { resolveWindow: RESOLVER });
  assert.deepEqual(usage, { tokens: 170_088, contextWindow: 200_000, percent: 85.044 });
});

test("returns null when the model window cannot be resolved", async () => {
  const file = sessionFile([assistant({ contextSnapshot: { promptTokens: 170_088 } }, "Model-NoWindow")]);
  assert.equal(await computeColdContextUsage(file, { resolveWindow: async () => null }), null);
});

test("returns null for a missing file", async () => {
  assert.equal(await computeColdContextUsage(join(tmpdir(), "nope-does-not-exist.jsonl"), { resolveWindow: RESOLVER }), null);
});

test("reuses a cached result for an unchanged file", async () => {
  const file = sessionFile([assistant({ contextSnapshot: { promptTokens: 170_088 } }, "Model-Counted")]);
  let calls = 0;
  const counting = async () => {
    calls += 1;
    return 200_000;
  };
  assert.equal((await computeColdContextUsage(file, { resolveWindow: counting }))?.tokens, 170_088);
  assert.equal((await computeColdContextUsage(file, { resolveWindow: counting }))?.tokens, 170_088);
  assert.equal(calls, 1, "second call must hit the size+mtime cache");
});

test("gives up on a slow window lookup instead of blocking the session load", async () => {
  const file = sessionFile([assistant({ contextSnapshot: { promptTokens: 170_088 } }, "Model-Slow")]);
  const slow = () => new Promise((resolve) => setTimeout(() => resolve(200_000), 5_000));
  const started = Date.now();
  assert.equal(await computeColdContextUsage(file, { resolveWindow: slow, timeoutMs: 50 }), null);
  assert.ok(Date.now() - started < 1_000, "must not wait for the slow lookup");
});

test("re-scans after the file grows", async () => {
  const file = sessionFile([assistant({ contextSnapshot: { promptTokens: 1000 } })]);
  assert.equal((await computeColdContextUsage(file, { resolveWindow: RESOLVER }))?.tokens, 1000);
  writeFileSync(
    file,
    [assistant({ contextSnapshot: { promptTokens: 1000 } }), assistant({ contextSnapshot: { promptTokens: 2000 } })].join("\n") + "\n",
    "utf8",
  );
  assert.equal((await computeColdContextUsage(file, { resolveWindow: RESOLVER }))?.tokens, 2000);
});
