import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { formatDuration } = await jiti.import("./session-timing.ts");

test("formats sub-minute durations as seconds", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(42_000), "42s");
  assert.equal(formatDuration(59_400), "59s");
});

test("formats minute durations with seconds when under an hour", () => {
  assert.equal(formatDuration(60_000), "1m");
  assert.equal(formatDuration(312_000), "5m 12s");
  assert.equal(formatDuration(3_599_000), "59m 59s");
});

test("formats hour durations compactly", () => {
  assert.equal(formatDuration(3_600_000), "1h 0m");
  assert.equal(formatDuration(8_123_000), "2h 15m");
});

test("handles missing or invalid input", () => {
  assert.equal(formatDuration(undefined), "0s");
  assert.equal(formatDuration(null), "0s");
  assert.equal(formatDuration(-1000), "0s");
  assert.equal(formatDuration(Number.NaN), "0s");
});
