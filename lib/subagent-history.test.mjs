import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { parseSubagentSpawns } = await jiti.import("./subagent-history.ts");
const { spawnSummary } = await jiti.import("./subagents.ts");

function writeSession(lines) {
  const dir = mkdtempSync(join(tmpdir(), "omp-subagents-"));
  const file = join(dir, "session.jsonl");
  writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

const TS = "2026-08-19T02:56:33.496Z";

test("batch spawn yields one record per tasks[] item", () => {
  const file = writeSession([
    JSON.stringify({
      type: "message",
      timestamp: TS,
      message: {
        role: "assistant",
        content: [{
          type: "toolCall",
          id: "task_0",
          name: "task",
          arguments: {
            tasks: [
              { name: "Alpha", agent: "task", effort: "med", task: "do alpha" },
              { name: "Beta", agent: "scout", task: "do beta" },
            ],
          },
        }],
      },
    }),
  ]);
  const spawns = parseSubagentSpawns(file);
  assert.equal(spawns.length, 2);
  assert.equal(spawns[0].name, "Alpha");
  assert.equal(spawns[0].agent, "task");
  assert.equal(spawns[0].effort, "med");
  assert.equal(spawns[0].callId, "task_0:0");
  assert.equal(spawns[1].name, "Beta");
  assert.equal(spawns[1].spawnedAt, TS);
});

test("single spawn form without tasks array", () => {
  const file = writeSession([
    JSON.stringify({
      type: "message",
      timestamp: TS,
      message: {
        role: "assistant",
        content: [{
          type: "toolCall",
          id: "task_3",
          name: "task",
          arguments: { task: "lone wolf task" },
        }],
      },
    }),
  ]);
  const spawns = parseSubagentSpawns(file);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].callId, "task_3");
  assert.equal(spawns[0].task, "lone wolf task");
  assert.equal(spawns[0].agent, "task");
});

test("ignores non-task tool calls, malformed lines, and missing files", () => {
  const file = writeSession([
    "not json at all",
    JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "b1", name: "bash", arguments: {} }] } }),
    JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "t9", name: "task", arguments: { tasks: [] } }] } }),
  ]);
  assert.deepEqual(parseSubagentSpawns(file), []);
  assert.deepEqual(parseSubagentSpawns("/nonexistent/session.jsonl"), []);
});

test("spawnSummary returns the first non-empty line", () => {
  assert.equal(spawnSummary({ task: "\n# Title\nbody" }), "# Title");
  assert.equal(spawnSummary({ task: "" }), "");
});
