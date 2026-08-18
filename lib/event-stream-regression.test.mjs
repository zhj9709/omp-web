import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { toClientAgentEvent } = await jiti.import("./agent-event-wire.ts");
const { INITIAL_STREAMING_STATE, streamReducer } = await jiti.import("./streaming-message.ts");
const sessionSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");

function assistantMessage(content = []) {
  return {
    role: "assistant",
    content,
    model: "claude-sonnet-4-6",
    provider: "anthropic",
    timestamp: 123,
  };
}

test("normalizes OMP's string contentIndex to a number on message_update", () => {
  const projected = toClientAgentEvent({
    type: "message_update",
    message: assistantMessage(),
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: "1",
      delta: "x",
      partial: assistantMessage(),
    },
  });
  assert.equal(projected.assistantMessageEvent.contentIndex, 1);
});

test("passes through a numeric contentIndex untouched", () => {
  const projected = toClientAgentEvent({
    type: "message_update",
    message: assistantMessage(),
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 2,
      delta: "x",
      partial: assistantMessage(),
    },
  });
  assert.equal(projected.assistantMessageEvent.contentIndex, 2);
});

test("falls back to contentIndex 0 for a non-numeric string", () => {
  const projected = toClientAgentEvent({
    type: "message_update",
    message: assistantMessage(),
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: "abc",
      delta: "x",
      partial: assistantMessage(),
    },
  });
  assert.equal(projected.assistantMessageEvent.contentIndex, 0);
});

test("message_update deltas are rAF-coalesced into one dispatch per frame", () => {
  assert.match(sessionSource, /pendingDeltasRef\.current\.push\(delta\)/);
  assert.match(sessionSource, /dispatch\(\{ type: "deltaBatch", events: deltas \}\)/);
  assert.match(sessionSource, /deltaFrameRef\.current = requestAnimationFrame/);
});

test("deltaBatch folds deltas in order into a single state transition", () => {
  let state = streamReducer(INITIAL_STREAMING_STATE, { type: "start" });
  state = streamReducer(state, { type: "snapshot", message: assistantMessage() });
  state = streamReducer(state, {
    type: "deltaBatch",
    events: [
      { type: "text_start", contentIndex: 0 },
      { type: "text_delta", contentIndex: 0, delta: "Hel" },
      { type: "text_delta", contentIndex: 0, delta: "lo" },
    ],
  });
  assert.deepEqual(state.streamingMessage.content, [{ type: "text", text: "Hello" }]);
});

test("end-to-end: OMP message_update deltas coalesce into a complete streamed message", () => {
  const partial = assistantMessage();
  const rawEvents = [
    { type: "message_update", message: partial, assistantMessageEvent: { type: "text_start", contentIndex: "0", partial } },
    { type: "message_update", message: partial, assistantMessageEvent: { type: "text_delta", contentIndex: "0", delta: "Hel", partial } },
    { type: "message_update", message: partial, assistantMessageEvent: { type: "text_delta", contentIndex: "0", delta: "lo", partial } },
    { type: "message_update", message: partial, assistantMessageEvent: { type: "text_delta", contentIndex: "0", delta: " world", partial } },
  ];
  const deltas = rawEvents.map((raw) => toClientAgentEvent(raw).assistantMessageEvent);

  let state = streamReducer(INITIAL_STREAMING_STATE, { type: "start" });
  state = streamReducer(state, { type: "snapshot", message: assistantMessage() });
  state = streamReducer(state, { type: "deltaBatch", events: deltas });

  assert.equal(state.isStreaming, true);
  assert.deepEqual(state.streamingMessage.content, [{ type: "text", text: "Hello world" }]);

  state = streamReducer(state, { type: "end" });
  assert.equal(state.isStreaming, false);
  assert.equal(state.streamingMessage, null);
});
