import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  tsconfigPaths: true,
});
const { nextTypewriterText } = await jiti.import("./useTypewriterText.ts");

test("advances by exactly the requested step", () => {
  assert.equal(nextTypewriterText("abc", "abcdef", 1), "abcd");
  assert.equal(nextTypewriterText("abc", "abcdef", 2), "abcde");
  assert.equal(nextTypewriterText("abc", "abcdef", 3), "abcdef");
});

test("cannot advance past the raw text and stops when caught up", () => {
  assert.equal(nextTypewriterText("abc", "abc", 5), null);
  assert.equal(nextTypewriterText("", "", 1), null);
  // gap 1: only the remaining character is revealed.
  assert.equal(nextTypewriterText("abcde", "abcdef", 8), "abcdef");
});

test("the step is clamped to at least one character", () => {
  assert.equal(nextTypewriterText("abc", "abcdef", 0), "abcd");
  assert.equal(nextTypewriterText("abc", "abcdef", -3), "abcd");
});

test("re-anchors immediately when the text is rewritten mid-stream", () => {
  assert.equal(nextTypewriterText("abc", "abX", 1), "abX");
  assert.equal(nextTypewriterText("hello world", "completely different", 2), "completely different");
});

test("jitter-buffer pacing: an upstream burst is revealed across frames, not dumped", () => {
  // Simulate the reveal loop against a 300-char wave that arrived at t=0:
  // everything before (now - BUFFER_DELAY_MS) is due, plus a catch-up share
  // of the recent window. The per-frame reveal is rate-limited (EMA pace,
  // capped at 24 chars), so a wave can never land in one frame — it spreads
  // over several frames as an even acceleration.
  const BUFFER_DELAY_MS = 600;
  const FRAME_MS = 16;
  const raw = "x".repeat(300);
  let display = 0;
  let pace = 0;
  const reveals = [];
  for (let frame = 0; frame < 60 && display < raw.length; frame++) {
    const now = frame * FRAME_MS;
    // Arrived at t=0: fully due once now passes the buffer delay; before
    // that, the 35% catch-up share of the recent window applies.
    const dueTotal = now >= BUFFER_DELAY_MS ? raw.length : 0;
    const newestTotal = raw.length;
    const target = dueTotal + (newestTotal - dueTotal) * 0.35;
    const backlog = target - display;
    if (backlog > 0) {
      const want = Math.max(1, Math.min(24, backlog * 0.25 + 1));
      pace = pace * 0.7 + want * 0.3;
    } else if (display < raw.length) {
      pace = Math.max(pace * 0.9, 2);
    } else {
      pace *= 0.85;
    }
    if (backlog <= 0 && pace < 0.5 && display === raw.length) break;
    const step = Math.max(1, Math.round(Math.min(pace, Math.max(backlog, 1))));
    const reveal = Math.min(Math.min(step, 24), raw.length - display);
    reveals.push(reveal);
    display += reveal;
  }
  assert.equal(display, raw.length, "fully revealed");
  // No single frame dumps the wave: every reveal is capped.
  assert.ok(Math.max(...reveals) <= 24, `max reveal ${Math.max(...reveals)}`);
  // And the buffer does not hold the text hostage: the wave is fully shown
  // shortly after the smoothing delay (not instantly, not minutes later).
  const frames = reveals.length;
  assert.ok(frames >= 5, `spread over ${frames} frames (not a dump)`);
  assert.ok(frames <= 50, `drained in ${frames} frames (no crawl)`);
});
