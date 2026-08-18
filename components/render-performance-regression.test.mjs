import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const markdownSource = await readFile(new URL("./MarkdownBody.tsx", import.meta.url), "utf8");
const chatInputSource = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const messageViewSource = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");
const chatWindowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const chatMinimapSource = await readFile(new URL("./ChatMinimap.tsx", import.meta.url), "utf8");
const statusBarSource = await readFile(new URL("./ExtensionStatusBar.tsx", import.meta.url), "utf8");
const widgetsSource = await readFile(new URL("./ExtensionWidgets.tsx", import.meta.url), "utf8");
const todosPanelSource = await readFile(new URL("./TodosPanel.tsx", import.meta.url), "utf8");
const subagentRosterSource = await readFile(new URL("./SubagentRoster.tsx", import.meta.url), "utf8");
const typewriterSource = await readFile(new URL("../hooks/useTypewriterText.ts", import.meta.url), "utf8");

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");
const { ChatInput } = await jiti.import("./ChatInput.tsx");

test("MarkdownBody is memoized with a children/isStreaming comparator", () => {
  assert.equal(MarkdownBody.$$typeof, Symbol.for("react.memo"));
  assert.match(markdownSource, /prev\.children === next\.children/);
  assert.match(markdownSource, /prev\.isStreaming === next\.isStreaming/);
});

test("ChatInput is memoized to skip needless re-renders", () => {
  assert.equal(ChatInput.$$typeof, Symbol.for("react.memo"));
  assert.match(chatInputSource, /memo\(forwardRef/);
});

test("the streaming duration tick updates tps on a fast window rate", () => {
  assert.match(messageViewSource, /setInterval\(tick, 100\)/);
  // Cumulative average since the first token: short windows spike to
  // thousands during a wave and collapse in inter-wave gaps (the fake
  // "2000+ t/s" lurching readings); cumulative tokens/elapsed converges to
  // the true sustained rate and is smooth by construction.
  assert.match(messageViewSource, /const cumulativeTps = tokens \/ elapsedSec;/);
});

test("ChatMinimap is memoized and ignores per-frame streamingMessage changes", () => {
  assert.match(chatMinimapSource, /export const ChatMinimap = memo\(function ChatMinimap/);
  assert.match(chatMinimapSource, /prev\.messages === next\.messages/);
  const comparator = chatMinimapSource.slice(chatMinimapSource.indexOf("(prev, next) => {"));
  assert.doesNotMatch(
    comparator,
    /prev\.streamingMessage === next\.streamingMessage/,
    "the minimap comparator must not compare streamingMessage (it changes every token frame)",
  );
});

test("per-frame streaming children (status bar, widgets, todos, subagents) are memoized", () => {
  assert.match(statusBarSource, /export const ExtensionStatusBar = memo\(function/);
  assert.match(widgetsSource, /export const ExtensionWidgets = memo\(function/);
  assert.match(todosPanelSource, /export const TodosPanel = memo\(function/);
  assert.match(subagentRosterSource, /export const SubagentRoster = memo\(function/);
  // ChatWindow passes stable callbacks so those memo()s are not defeated.
  assert.match(chatWindowSource, /const handleRefreshSubagents = useCallback/);
  assert.match(chatWindowSource, /const handleTodosClose = useCallback/);
});

test("the streaming bubble renders every frame and reveals text via the typewriter buffer", () => {
  // The tail renders the raw per-frame streaming message (no throttling) ...
  const tailRender = chatWindowSource.slice(chatWindowSource.indexOf("{streamState.isStreaming && hasStreamingContent"));
  assert.match(tailRender, /MessageView message=\{streamState\.streamingMessage as AgentMessage\}/);
  assert.doesNotMatch(tailRender, /throttledStreamingMessage/);
  // ... and the text block smooths the display with the typewriter hook.
  assert.match(messageViewSource, /const displayText = useTypewriterText\(block\.text, Boolean\(isStreaming\)\)/);
  assert.match(messageViewSource, /\{displayText\}/);
});

test("the typewriter hook reveals text steadily and re-anchors on rewrite", () => {
  assert.match(typewriterSource, /export function useTypewriterText/);
  assert.match(typewriterSource, /export function nextTypewriterText/);
  assert.match(typewriterSource, /requestAnimationFrame\(tick\)/);
  // Mount-time content is shown immediately (history — snapshot/remount);
  // only post-mount deltas are paced.
  assert.match(typewriterSource, /const \[displayText, setDisplayText\] = useState\(rawText\)/);
  // Jitter-buffer pacing: the display trails the raw stream by a smoothing
  // delay so upstream bursts (waves separated by 60-400ms pauses) spread
  // into an even per-frame reveal — sprint-then-stall drains read as
  // chunked output regardless of step tuning.
  assert.match(typewriterSource, /BUFFER_DELAY_MS/);
  assert.match(typewriterSource, /arrivalsRef\.current\.push\(\{ t: now, total: rawText\.length \}\)/);
  // Rate-limited reveal pace (EMA), capped so one frame never dumps.
  assert.match(typewriterSource, /pace = pace \* 0\.7 \+ want \* 0\.3/);
  assert.match(typewriterSource, /Math\.min\(step, 24\)/);
  // Immediate re-anchor when the text is rewritten mid-stream.
  assert.match(typewriterSource, /return raw;\n\}/);
});

test("the prompt-anchor spacer measurement is off the synchronous layout path", () => {
  // Streaming updates must not force a sync style recalc + layout read per
  // frame; the measurement is deferred to a rAF (coalescing with the
  // ResizeObserver-driven one).
  const anchorEffect = chatWindowSource.slice(
    chatWindowSource.indexOf("useLayoutEffect(() => {\n    // The prompt-anchor spacer height"),
    chatWindowSource.indexOf("}, [streamState.streamingMessage]);"),
  );
  assert.match(anchorEffect, /requestAnimationFrame/);
  // The update call must appear exactly once — inside the rAF callback. A
  // second occurrence would mean the synchronous layout-path call is back.
  const updateCalls = (anchorEffect.match(/promptAnchorUpdateRef\.current\?\.\(\)/g) ?? []).length;
  assert.equal(updateCalls, 1);
});
