import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { extractLatestGoal, normalizeGoalEvent } = await jiti.import("./goal.ts");

const GOAL = {
  id: "g1",
  objective: "Ship the payment module",
  status: "active",
  tokensUsed: 1234,
  timeUsedSeconds: 3600,
  tokenBudget: 100_000,
  createdAt: 1000,
  updatedAt: 4600,
};

test("extractLatestGoal returns the most recent goal mode_change", () => {
  const entries = [
    { type: "message", id: "m1" },
    { type: "mode_change", id: "mc1", mode: "goal", data: { goal: GOAL } },
    { type: "message", id: "m2" },
    { type: "mode_change", id: "mc2", mode: "goal_paused", data: { goal: { ...GOAL, status: "paused" } } },
  ];
  const goal = extractLatestGoal(entries);
  assert.ok(goal);
  assert.equal(goal.status, "paused");
  assert.equal(goal.enabled, false);
});

test("extractLatestGoal skips non-goal mode changes and malformed goals", () => {
  const entries = [
    { type: "mode_change", id: "mc1", mode: "plan", data: { plan: {} } },
    { type: "mode_change", id: "mc2", mode: "goal", data: {} },
    { type: "mode_change", id: "mc3", mode: "goal", data: { goal: { id: "x" } } },
  ];
  assert.equal(extractLatestGoal(entries), null);
  assert.equal(extractLatestGoal([]), null);
});

test("extractLatestGoal marks an enabled goal", () => {
  const goal = extractLatestGoal([
    { type: "mode_change", id: "mc1", mode: "goal", data: { goal: GOAL } },
  ]);
  assert.ok(goal);
  assert.equal(goal.enabled, true);
});

test("normalizeGoalEvent maps a goal_updated frame", () => {
  const info = normalizeGoalEvent({
    goal: GOAL,
    state: { enabled: true, mode: "active", goal: GOAL },
  });
  assert.ok(info);
  assert.equal(info.objective, "Ship the payment module");
  assert.equal(info.tokensUsed, 1234);
  assert.equal(info.enabled, true);
});

test("normalizeGoalEvent rejects malformed frames", () => {
  assert.equal(normalizeGoalEvent({}), null);
  assert.equal(normalizeGoalEvent({ goal: { id: "x" } }), null);
  assert.equal(normalizeGoalEvent({ goal: null, state: null }), null);
});
