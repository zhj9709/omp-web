import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
const chatWindowSource = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
const chatInputSource = await readFile(new URL("../components/ChatInput.tsx", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8")
  + "\n" + await readFile(new URL("../components/TopBar.tsx", import.meta.url), "utf8");
const catalogSource = await readFile(new URL("../lib/slash-command-catalog.ts", import.meta.url), "utf8");
const sessionTypesSource = await readFile(new URL("./agent-session/types.ts", import.meta.url), "utf8");
const extensionUiSource = await readFile(new URL("./agent-session/extension-ui.ts", import.meta.url), "utf8");
const coalescersSource = await readFile(new URL("./agent-session/coalescers.ts", import.meta.url), "utf8");
const scrollSource = await readFile(new URL("./agent-session/scroll.ts", import.meta.url), "utf8");
const eventStreamSource = await readFile(new URL("./agent-session/event-stream.ts", import.meta.url), "utf8");
const sessionLoaderSource = await readFile(new URL("./agent-session/session-loader.ts", import.meta.url), "utf8");
const commandsSource = await readFile(new URL("./agent-session/commands.ts", import.meta.url), "utf8");
const dispatcherSource = await readFile(new URL("./agent-session/event-dispatcher.ts", import.meta.url), "utf8");
const newSessionFlowSource = await readFile(new URL("./agent-session/new-session.ts", import.meta.url), "utf8");

test("keeps the session event stream open through the idle grace window", () => {
  const finishSource = eventStreamSource.slice(
    eventStreamSource.indexOf("const finishPromptWithoutStream"),
    eventStreamSource.indexOf("const waitForPromptSettlement"),
  );
  const graceSource = eventStreamSource.slice(
    eventStreamSource.indexOf("const scheduleEventStreamClose"),
    eventStreamSource.indexOf("const finishPromptWithoutStream"),
  );
  const agentEndSource = dispatcherSource.slice(
    dispatcherSource.indexOf('case "agent_end"'),
    dispatcherSource.indexOf('case "agent_settled"'),
  );
  const agentStartSource = dispatcherSource.slice(
    dispatcherSource.indexOf('case "agent_start"'),
    dispatcherSource.indexOf('case "agent_end"'),
  );
  const agentSettledSource = dispatcherSource.slice(
    dispatcherSource.indexOf('case "agent_settled"'),
    dispatcherSource.indexOf('case "prompt_done"'),
  );
  const promptDoneSource = dispatcherSource.slice(
    dispatcherSource.indexOf('case "prompt_done"'),
    dispatcherSource.indexOf('case "prompt_error"'),
  );
  const sendSource = commandsSource.slice(
    commandsSource.indexOf("  const handleSend = useCallback"),
    commandsSource.indexOf("  const executeBash = useCallback"),
  );

  assert.match(eventStreamSource, /const EVENT_STREAM_IDLE_GRACE_MS = 30_000/);
  assert.match(graceSource, /setTimeout\(\(\) => void checkServerIdle\(\), EVENT_STREAM_IDLE_GRACE_MS\)/);
  assert.match(graceSource, /fetch\(`\/api\/agent\/\$\{encodeURIComponent\(sid\)\}`\)/);
  assert.match(graceSource, /closeEvents\(\)/);
  assert.match(finishSource, /scheduleEventStreamClose\(sid\)/);
  assert.doesNotMatch(finishSource, /closeEvents\(\)/);
  assert.doesNotMatch(agentEndSource, /closeEvents\(\)/);
  assert.match(agentStartSource, /cancelEventStreamGrace\(\)/);
  assert.match(agentSettledSource, /scheduleEventStreamClose\(sid\)/);
  assert.match(agentSettledSource, /onAgentEnd\?\.\(\)/);
  assert.match(promptDoneSource, /notifyPromptStage\(runId\)/);
  assert.match(promptDoneSource, /scheduleEventStreamClose\(sid\)/);
  assert.match(sendSource, /const definitivelyRejected = !promptRequestStarted/);
  assert.match(sendSource, /if \(!definitivelyRejected && sentSessionId\) \{[\s\S]*?waitForPromptSettlement/);
  assert.match(sendSource, /restoreSubmission\(message, images, composerDraftKey\);[\s\S]*?if \(sentSessionId\) \{[\s\S]*?reconcileAgentState\(sentSessionId\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?closeEvents\(\)/);
  assert.doesNotMatch(
    sendSource,
    /rpcPromptPendingRef\.current = false;\s*agentRunningRef\.current = false;\s*closeEvents\(\)/,
  );
});

test("a rejected submission preserves a different run reported by the server", () => {
  const reconcileSource = eventStreamSource.slice(
    eventStreamSource.indexOf("  const reconcileAgentState = useCallback"),
    eventStreamSource.indexOf("  // Recovery net for missed SSE events"),
  );

  assert.match(reconcileSource, /sessionIdRef\.current !== sid/);
  assert.match(reconcileSource, /if \(busy\) \{[\s\S]*?sdkAgentActiveRef\.current = Boolean\(state\.isStreaming\)/);
  assert.match(reconcileSource, /rpcPromptPendingRef\.current = Boolean\(state\.isPromptRunning\)/);
  assert.match(reconcileSource, /if \(!agentRunningRef\.current\) return;[\s\S]*?finishPromptWithoutStream/);
});

test("opening System lazily starts a dormant session without sending a prompt", () => {
  const loadSystemPromptSource = commandsSource.slice(
    commandsSource.indexOf("  const loadSystemPrompt = useCallback"),
    commandsSource.indexOf("  const loadSlashCommands = useCallback"),
  );
  const loaderEffectSource = source.slice(
    source.indexOf("  useEffect(() => {\n    onSystemPromptLoaderChange"),
    source.indexOf("  useEffect(() => {\n    if (!onBranchDataChange) return;"),
  );

  assert.match(loadSystemPromptSource, /sessionIdRef\.current \?\? await ensureNewSession\(\)/);
  assert.doesNotMatch(loadSystemPromptSource, /promoteNewSession\(\)/);
  assert.match(loadSystemPromptSource, /sendAgentCommand<AgentStateResponse>\(sid, \{ type: "get_state" \}\)/);
  assert.doesNotMatch(loadSystemPromptSource, /type: "prompt"/);
  assert.match(loadSystemPromptSource, /setSystemPrompt\(state\.systemPrompt \?\? ""\)/);
  assert.match(loaderEffectSource, /onSystemPromptLoaderChange\?\.\(loadSystemPrompt\)/);
  assert.match(loaderEffectSource, /onSystemPromptLoaderChange\?\.\(null\)/);
  assert.match(appShellSource, /onClick=\{\(\) => handleSystemPromptToggle\(mobile\)\}/);
  assert.match(appShellSource, /systemPromptLoaderRef\.current/);
  assert.doesNotMatch(appShellSource, /systemPrompt !== null \|\| systemPromptLoading/);
  assert.match(appShellSource, /const loadId = \+\+systemPromptLoadIdRef\.current/);
  assert.match(appShellSource, /systemPromptLoadIdRef\.current === loadId/);
  assert.match(
    appShellSource,
    /handleSystemPromptLoaderChange[\s\S]*?systemPromptLoadIdRef\.current \+= 1;[\s\S]*?setSystemPromptLoading\(false\)/,
  );
});

test("new-session promotion rekeys drafts before publishing the real session", () => {
  const promoteSource = newSessionFlowSource.slice(
    newSessionFlowSource.indexOf("  const promoteNewSession = useCallback"),
    newSessionFlowSource.indexOf("  const ensureNewSession = useCallback"),
  );

  assert.match(promoteSource, /draftKeyAliasesRef\.current\.set\(provisionalDraftKey, sid\)/);
  assert.match(promoteSource, /input\.rekeyDraft\(provisionalDraftKey, sid\)/);
  assert.ok(
    promoteSource.indexOf("input.rekeyDraft(provisionalDraftKey, sid)")
      < promoteSource.indexOf("onSessionCreated?.({"),
  );
  assert.match(promoteSource, /}, provisionalDraftKey\)/);
  assert.match(chatWindowSource, /draftKey=\{session\?\.id \?\? newSessionDraftKey \?\? undefined\}/);
});

test("fresh sessions restore the preferred tool preset without overriding existing sessions", () => {
  const preferenceSource = commandsSource.slice(
    commandsSource.indexOf("  // Fresh sessions restore the persisted tool-preset"),
    commandsSource.indexOf("  const resolveComposerDraftKey"),
  );
  const loadToolsSource = sessionLoaderSource.slice(
    sessionLoaderSource.indexOf("  const loadTools = useCallback"),
    sessionLoaderSource.indexOf("  return {"),
  );
  const changeSource = commandsSource.slice(
    commandsSource.indexOf("  const handleToolPresetChange = useCallback"),
  );

  assert.match(
    preferenceSource,
    /useLayoutEffect\(\(\) => \{\s*if \(!isNew \|\| sessionIdRef\.current\) return;\s*const preferred = getPreferredToolPreset\(\)/,
  );
  assert.match(
    preferenceSource,
    /setToolPresetState\(\s*isRestrictiveToolRequest\(getToolNamesForPreset\(preferred\)\) \? "default" : preferred,\s*\)/,
  );
  assert.match(changeSource, /setPreferredToolPreset\(preset\)/);
  assert.match(changeSource, /sendAgentCommand\(sid, \{ type: "set_tools", toolNames \}\)/);
  assert.doesNotMatch(loadToolsSource, /setPreferredToolPreset/);
});

test("submission recovery updates live refs before a possible session rekey", () => {
  const restoreMethod = chatInputSource.slice(
    chatInputSource.indexOf("    restoreSubmission(text:"),
    chatInputSource.indexOf("    insertText(text:"),
  );

  assert.ok(
    restoreMethod.indexOf("valueRef.current = restoredDraft.value")
      < restoreMethod.indexOf("setValue((current) =>"),
  );
  assert.ok(
    restoreMethod.indexOf("attachedImagesRef.current = restoredImages")
      < restoreMethod.indexOf("setAttachedImages((current) =>"),
  );
});

test("stale fresh-session completion cannot replace the active composer", () => {
  const cwdChangeSource = appShellSource.slice(
    appShellSource.indexOf("  const handleCwdChange = useCallback"),
    appShellSource.indexOf("  const handleSelectSession = useCallback"),
  );
  const newSessionSource = appShellSource.slice(
    appShellSource.indexOf("  const handleNewSession = useCallback"),
    appShellSource.indexOf("  // Global keyboard shortcuts"),
  );
  const createdSource = appShellSource.slice(
    appShellSource.indexOf("  const handleSessionCreated = useCallback"),
    appShellSource.indexOf("  const handleAgentEnd = useCallback"),
  );

  assert.match(newSessionSource, /const draftKey = `new:\$\{sessionId\}:\$\{cwd\}`/);
  assert.match(newSessionSource, /activeNewSessionDraftKeyRef\.current = draftKey/);
  assert.match(createdSource, /activeNewSessionDraftKeyRef\.current !== sourceDraftKey/);
  assert.match(cwdChangeSource, /const currentFreshCwd = newSessionCwd \?\? activeCwd/);
  assert.match(
    cwdChangeSource,
    /currentProject === newProject\s*&& \(selectedSession !== null \|\| currentFreshCwd === cwd\)/,
  );
  assert.match(cwdChangeSource, /if \(currentProject !== newProject\) \{[\s\S]*?setFileTabs\(\[\]\)/);
  assert.match(
    appShellSource,
    /useLayoutEffect\(\(\) => \{\s*activeNewSessionDraftKeyRef\.current = newSessionDraftKey;/,
  );
  assert.ok(
    createdSource.indexOf("activeNewSessionDraftKeyRef.current !== sourceDraftKey")
      < createdSource.indexOf("setSelectedSession(session)"),
  );
});

test("abandoned fresh-session drafts are cleared and cannot be recreated by late rejection", () => {
  const restoreSource = commandsSource.slice(
    commandsSource.indexOf("  const restoreSubmission = useCallback"),
    commandsSource.indexOf("  // Opening the System panel is also allowed"),
  );
  const mountSource = source.slice(
    source.indexOf("  // Load session on mount"),
    source.indexOf("  useEffect(() => {\n    onSystemPromptChange"),
  );

  assert.match(restoreSource, /!sessionHookMountedRef\.current[\s\S]*?!newSessionPromotedRef\.current/);
  assert.match(mountSource, /const abandonedDraftKey = isNew \? newSessionDraftKey : null/);
  assert.match(mountSource, /clearDraft\(abandonedDraftKey\)/);
});

test("streaming submissions cannot be stranded in an idle direct queue", () => {
  const queueSource = commandsSource.slice(
    commandsSource.indexOf("  // Let AgentSession.prompt decide atomically"),
    commandsSource.indexOf("  const handleAbortCompaction"),
  );

  assert.match(queueSource, /type: "prompt"/);
  assert.match(queueSource, /streamingBehavior: behavior/);
  assert.match(queueSource, /if \(isPromptRejectedError\(e\)\) restore\(\)/);
  assert.doesNotMatch(queueSource, /type: "steer"/);
  assert.doesNotMatch(queueSource, /type: "follow_up"/);
});

test("post-accept prompt errors do not duplicate the user submission", () => {
  const promptErrorSource = dispatcherSource.slice(
    dispatcherSource.indexOf('case "prompt_error"'),
    dispatcherSource.indexOf('case "extension_error"'),
  );

  assert.match(promptErrorSource, /addNotice/);
  assert.doesNotMatch(promptErrorSource, /restoreSubmission/);
});

test("delegates event stream readiness and hides an empty agent phase", () => {
  const ensureSource = eventStreamSource.slice(
    eventStreamSource.indexOf("const ensureEventsConnected"),
    eventStreamSource.indexOf("const settleUiStage"),
  );

  assert.match(eventStreamSource, /new AgentEventConnection\(\{/);
  assert.match(eventStreamSource, /shouldMaintain: \(sid\)[\s\S]*?sessionIdRef\.current === sid/);
  assert.match(ensureSource, /eventConnectionRef\.current!\.ensureConnected\(sid\)/);
  assert.match(ensureSource, /eventConnectionRef\.current!\.maintain\(sid\)/);
  assert.match(chatWindowSource, /const hasStreamingContent = Boolean\(streamState\.streamingMessage\?\.content\.length\)/);
  assert.match(chatWindowSource, /streamState\.isStreaming && hasStreamingContent && streamState\.streamingMessage/);
  assert.match(chatWindowSource, /agentRunning && agentPhase && \(!hasStreamingContent \|\| agentPhase\.kind === "running_tools"\)/);
  assert.match(chatWindowSource, /return null;/);
});

test("uses one absolute agent-readiness deadline instead of a five-second transport deadline", () => {
  assert.match(eventStreamSource, /EVENT_STREAM_READY_TIMEOUT_MS = 60_000/);
  assert.doesNotMatch(eventStreamSource, /EVENT_STREAM_OPEN_TIMEOUT_MS/);
});

test("connects a selected session when another browser reports it running", () => {
  assert.match(sessionTypesSource, /sessionRunning\?: boolean/);
  assert.match(
    eventStreamSource,
    /if \(!sessionId \|\| !sessionRunning\) return;[\s\S]*?maintainEventsConnected\(sessionId\)/,
  );
  assert.match(eventStreamSource, /maintainEventsConnected\(sessionId\)/);
  assert.doesNotMatch(source, /void connectEvents\(/);
  assert.match(chatWindowSource, /sessionRunning\?: boolean/);
  assert.match(chatWindowSource, /session, sessionRunning, newSessionCwd/);
  assert.match(appShellSource, /runningSessionIds\.has\(selectedSession\.id\)/);
  assert.match(appShellSource, /onRunningSessionIdsChange=\{handleRunningSessionIdsChange\}/);
});

test("keeps one reducer-owned assistant partial and consumes Pi JSON deltas", () => {
  const connectedSource = dispatcherSource.slice(
    dispatcherSource.indexOf('case "connected"'),
    dispatcherSource.indexOf('case "agent_start"'),
  );
  const streamSource = dispatcherSource.slice(
    dispatcherSource.indexOf('case "message_start"'),
    dispatcherSource.indexOf('case "message_end"'),
  );
  const messageEndSource = dispatcherSource.slice(
    dispatcherSource.indexOf('case "message_end"'),
    dispatcherSource.indexOf('case "tool_execution_start"'),
  );

  assert.match(source, /streamReducer,/);
  assert.match(coalescersSource, /ClientAssistantMessageEvent/);
  assert.doesNotMatch(source, /streamingMessageRef/);
  assert.match(connectedSource, /dispatch\(\{ type: "end" \}\)/);
  assert.match(connectedSource, /event\.isStreaming === true/);
  assert.match(connectedSource, /agentRunningRef\.current = true/);
  assert.match(streamSource, /msg\?\.role === "assistant"[\s\S]*dispatch\(\{ type: "snapshot", message: msg \}\)/);
  assert.match(streamSource, /event\.assistantMessageEvent as ClientAssistantMessageEvent/);
  assert.match(coalescersSource, /pendingDeltasRef\.current\.push\(delta\)/);
  assert.match(coalescersSource, /requestAnimationFrame/);
  assert.match(coalescersSource, /dispatch\(\{ type: "deltaBatch", events: deltas \}\)/);
  assert.doesNotMatch(streamSource, /dispatch\(\{ type: "delta", event: delta \}\)/);
  assert.match(streamSource, /delta\.type !== "toolcall_start" && delta\.type !== "toolcall_delta"/);
  assert.doesNotMatch(streamSource, /case "message_delta"/);
  assert.match(messageEndSource, /const completed = event\.message as AgentMessage/);
  assert.match(messageEndSource, /normalizeToolCalls\(completed\)/);
  assert.match(messageEndSource, /dispatch\(\{ type: "end" \}\)/);
  assert.doesNotMatch(messageEndSource, /streamState\.streamingMessage/);
});

test("shows the latest streamed tool execution progress in the running phase", () => {
  const updateSource = dispatcherSource.slice(
    dispatcherSource.indexOf('case "tool_execution_update"'),
    dispatcherSource.indexOf('case "tool_execution_end"'),
  );

  assert.match(updateSource, /getToolExecutionProgress\(event\.partialResult\)/);
  assert.match(updateSource, /tools: \[\.\.\.tools\.filter\([\s\S]*?, updated\]/);
  assert.match(chatWindowSource, /if \(latest\?\.progress\)/);
  // Terminal-style phase label: concrete detail/progress shown directly
  // instead of the removed chat.runningNamedTool i18n key.
  assert.match(
    chatWindowSource,
    /latest\?\.detail\) return latest\.detail[\s\S]*latest\?\.progress\) return `\$\{latest\.name\} \$\{latest\.progress\}`/,
  );
});

test("plays the enabled sound once for each extension dialog", () => {
  assert.match(chatWindowSource, /soundedExtensionDialogIdRef = useRef<string \| null>\(null\)/);
  assert.match(
    chatWindowSource,
    /soundedExtensionDialogIdRef\.current === extensionDialog\.id/,
  );
  assert.match(chatWindowSource, /soundedExtensionDialogIdRef\.current = extensionDialog\.id/);
  assert.match(chatWindowSource, /playDoneSoundRef\.current\(\)/);
});

test("routes blocking extension requests through deduplicated browser attention notifications", () => {
  const completionSource = appShellSource.slice(
    appShellSource.indexOf("  const handleAgentEnd = useCallback"),
    appShellSource.indexOf("  const handleAttentionNeeded = useCallback"),
  );
  const extensionRequestSource = extensionUiSource.slice(
    extensionUiSource.indexOf("  const handleExtensionUiRequest = useCallback"),
  );
  const attentionSource = appShellSource.slice(
    appShellSource.indexOf("  const handleAttentionNeeded = useCallback"),
    appShellSource.indexOf("  const handleAutoName = useCallback"),
  );

  assert.match(
    extensionRequestSource,
    /isBlockingExtensionUiRequest\(request\)[\s\S]*?onAttentionNeeded\?\.\(request\)/,
  );
  assert.match(chatWindowSource, /onAttentionNeeded, onSessionCreated/);
  assert.match(completionSource, /if \(!shouldShowBrowserNotification\(\)\) return/);
  assert.doesNotMatch(completionSource, /document\.visibilityState === "visible"/);
  assert.match(attentionSource, /shouldShowBrowserNotification\(\)/);
  assert.match(attentionSource, /claimExtensionAttentionNotification\(request, notifiedAttentionRequestIdsRef\.current\)/);
  assert.match(attentionSource, /tag: `pi-extension-ui:\$\{request\.id\}`/);
  assert.match(appShellSource, /onAttentionNeeded=\{handleAttentionNeeded\}/);
});

test("keeps live following cancellable when the user scrolls away from the tail", () => {
  const streamUpdateSource = dispatcherSource.slice(
    dispatcherSource.indexOf('case "message_start"'),
    dispatcherSource.indexOf('case "message_end"'),
  );
  const scrollHandlerSource = scrollSource.slice(
    scrollSource.indexOf("const handleScrollPositionChange"),
  );
  const scrollToBottomSource = scrollSource.slice(
    scrollSource.indexOf("const scrollToBottom"),
  );

  assert.match(scrollSource, /const liveFollowFrameRef = useRef<number \| null>\(null\)/);
  assert.match(scrollSource, /const previousScrollTopRef = useRef\(0\)/);
  assert.match(scrollSource, /const wasAttached = isNearBottomRef\.current;[\s\S]*?const isAttached = getLiveFollowAttached\([\s\S]*?wasAttached,[\s\S]*?previousScrollTopRef\.current,[\s\S]*?scrollTop,[\s\S]*?clientHeight,[\s\S]*?scrollHeight/);
  assert.match(scrollHandlerSource, /const isAgentRunning = agentRunningRef\.current;[\s\S]*?isAgentRunning\s*\? CHAT_SCROLL_REATTACH_TOLERANCE\s*:\s*CHAT_SCROLL_TAIL_TOLERANCE/);
  assert.match(scrollSource, /previousScrollTopRef\.current = scrollTop/);
  assert.match(scrollToBottomSource, /messagesEndRef\.current\?\.scrollIntoView\(\{ behavior \}\);\s*\}\s*if \(container\) previousScrollTopRef\.current = container\.scrollTop/);
  assert.match(streamUpdateSource, /liveFollowFrameRef\.current === null/);
  assert.match(streamUpdateSource, /requestAnimationFrame\(\(\) => \{[\s\S]*?liveFollowFrameRef\.current = null;[\s\S]*?if \(isNearBottomRef\.current\) scrollToBottom\("auto"\)/);
  assert.match(scrollHandlerSource, /!wasAttached && isAttached && isAgentRunning[\s\S]*?scrollToBottom\("auto"\)/);
  assert.match(scrollHandlerSource, /cancelAnimationFrame\(liveFollowFrameRef\.current\)/);
  assert.match(scrollSource, /previousScrollTopRef\.current = container\.scrollTop;\s*container\.addEventListener\("scroll", handleScrollPositionChange/);
  assert.doesNotMatch(source, /SCROLL_BOTTOM_THRESHOLD|completionScrollAllowedRef|ignoreProgrammaticScrollUntilRef/);
});

test("keeps a newly sent user message at the top while its response starts", () => {
  const streamUpdateSource = dispatcherSource.slice(
    dispatcherSource.indexOf('case "message_start"'),
    dispatcherSource.indexOf('case "message_end"'),
  );
  const userScrollSource = scrollSource.slice(
    scrollSource.indexOf("const scrollUserMsgToTop"),
    scrollSource.indexOf("const handleScrollPositionChange"),
  );
  const scrollEffectSource = scrollSource.slice(
    scrollSource.indexOf("useLayoutEffect(() => {\n    if (messages.length > 0)"),
  );

  assert.match(streamUpdateSource, /!pendingScrollToUserRef\.current && isNearBottomRef\.current/);
  assert.match(scrollSource, /const \[promptAnchorActive, setPromptAnchorActive\] = useState\(false\)/);
  assert.match(commandsSource, /pendingScrollToUserRef\.current = true;\s*setPromptAnchorActive\(true\)/);
  assert.match(userScrollSource, /const targetTop = Math\.min\(Math\.max\(0, elAbsTop - 16\), maxScrollTop\)/);
  assert.match(userScrollSource, /cancelAnimationFrame\(liveFollowFrameRef\.current\)/);
  assert.match(userScrollSource, /isNearBottomRef\.current = true/);
  assert.match(userScrollSource, /previousScrollTopRef\.current = targetTop/);
  assert.match(userScrollSource, /container\.scrollTo\(\{ top: targetTop, behavior: "auto" \}\)/);
  assert.match(scrollEffectSource, /pendingScrollToUserRef\.current = false;[\s\S]*?scrollUserMsgToTop\(\)/);
  assert.match(chatWindowSource, /const contentEnd = spacer\.getBoundingClientRect\(\)\.top[\s\S]*?getPromptAnchorSpacerHeight\([\s\S]*?targetTop,[\s\S]*?contentEnd,[\s\S]*?container\.clientHeight/);
  assert.match(chatWindowSource, /<div ref=\{promptAnchorSpacerRef\} aria-hidden="true" \/>/);
  assert.match(chatWindowSource, /const promptAnchorAdjustmentDoneRef = useRef\(false\)/);
  assert.match(chatWindowSource, /promptAnchorAdjustmentDoneRef\.current = false/);
  assert.match(chatWindowSource, /const isInitialMeasurement = !promptAnchorAdjustmentDoneRef\.current;[\s\S]*?promptAnchorAdjustmentDoneRef\.current = true;[\s\S]*?if \(needsInitialAdjustment\) scrollUserMsgToTop\(\)/);
});

test("jumps to the latest content through the scroll hook instead of poking its refs", () => {
  const jumpSource = scrollSource.slice(
    scrollSource.indexOf("const jumpToLatest"),
    scrollSource.indexOf("const scrollUserMsgToTop"),
  );
  // Destructured out of useChatScroll and re-exported by useAgentSession.
  const jumpWiring = source.match(/scrollToBottom, jumpToLatest, scrollUserMsgToTop/g) ?? [];

  assert.match(jumpSource, /isNearBottomRef\.current = true;\s*setIsNearBottom\(true\);\s*scrollToBottom\("smooth"\)/);
  assert.match(scrollSource, /scrollToBottom,\s*jumpToLatest,\s*scrollUserMsgToTop,/);
  assert.equal(jumpWiring.length, 2);
  assert.match(chatWindowSource, /onClick=\{jumpToLatest\}/);
  assert.match(chatWindowSource, /t\("chat\.jumpToLatest"\)/);
  // The button must not reach into the hook's attachment ref: marking the tail
  // as attached belongs to jumpToLatest, which also updates the visible state.
  assert.doesNotMatch(chatWindowSource, /isNearBottomRef/);
});

test("keeps prompt anchor measurement outside the React update cycle", () => {
  const anchorEffectStart = chatWindowSource.indexOf(
    "useLayoutEffect(() => {\n    const spacer = promptAnchorSpacerRef.current;",
  );
  assert.notEqual(anchorEffectStart, -1);
  const syncEffectStart = chatWindowSource.indexOf(
    "useLayoutEffect(() => {\n    // The prompt-anchor spacer height",
    anchorEffectStart,
  );
  assert.notEqual(syncEffectStart, -1);
  const anchorLifecycleEffectSource = chatWindowSource.slice(
    anchorEffectStart,
    syncEffectStart,
  );
  const anchorSyncEffectSource = chatWindowSource.slice(
    syncEffectStart,
    chatWindowSource.indexOf("const availableThinkingLevels"),
  );

  assert.doesNotMatch(anchorLifecycleEffectSource, /\bset[A-Z][A-Za-z0-9]*\s*\(/);
  assert.doesNotMatch(anchorSyncEffectSource, /\bset[A-Z][A-Za-z0-9]*\s*\(/);
  assert.doesNotMatch(chatWindowSource, /setPromptAnchorSpacer|useState[^\n]*promptAnchorSpacer/);
  assert.doesNotMatch(anchorLifecycleEffectSource, /streamState\.streamingMessage/);
  assert.match(anchorLifecycleEffectSource, /spacer\.style\.height = nextPromptAnchorSpacerHeight > 0/);
  assert.match(anchorLifecycleEffectSource, /promptAnchorUpdateRef\.current = updatePromptAnchorSpacer/);
  assert.match(anchorLifecycleEffectSource, /new ResizeObserver\(schedulePromptAnchorMeasure\)/);
  assert.match(anchorLifecycleEffectSource, /observer\?\.observe\(messageContent\)/);
  assert.match(anchorLifecycleEffectSource, /if \(disposed \|\| promptAnchorMeasureFrameRef\.current !== null\) return/);
  assert.match(anchorLifecycleEffectSource, /promptAnchorMeasureFrameRef\.current = requestAnimationFrame\(\(\) => \{\s*promptAnchorMeasureFrameRef\.current = null;\s*updatePromptAnchorSpacer\(\)/);
  assert.match(anchorLifecycleEffectSource, /disposed = true;[\s\S]*?promptAnchorUpdateRef\.current === updatePromptAnchorSpacer[\s\S]*?cancelAnimationFrame\(promptAnchorMeasureFrameRef\.current\)/);
  // The streaming-frame update must run off the synchronous layout path: it
  // defers to a rAF (coalescing with the ResizeObserver-driven measurement)
  // instead of forcing a style recalc + layout read + spacer write per frame.
  assert.match(anchorSyncEffectSource, /const update = promptAnchorUpdateRef\.current;[\s\S]*?requestAnimationFrame\(\(\) => \{\s*promptAnchorUpdateRef\.current\?\.\(\);\s*\}\);[\s\S]*?cancelAnimationFrame\(raf\)/);
  assert.match(chatWindowSource, /<div ref=\{messageContentRef\} style=\{\{/);
});

test("uses the prompt anchor as the only trailing message spacer", () => {
  assert.match(chatWindowSource, /<div ref=\{promptAnchorSpacerRef\} aria-hidden="true" \/>[\s\S]*?<div ref=\{messagesEndRef\} \/>/);
  assert.doesNotMatch(chatWindowSource, /bottomComposer(?:Ref|Height|ScrollFrameRef)/);
  assert.doesNotMatch(chatWindowSource, /new ResizeObserver\(updateBottomComposerHeight\)/);
});

test("keeps a detached viewport in place when streaming completes", () => {
  const scrollEffectSource = scrollSource.slice(
    scrollSource.indexOf("useLayoutEffect(() => {\n    if (messages.length > 0)"),
  );

  assert.match(scrollEffectSource, /isNearBottomRef\.current[\s\S]*?scrollToBottom\("auto"\)/);
  assert.doesNotMatch(scrollEffectSource, /\|\|/);
  assert.match(scrollSource, /addEventListener\("scroll", handleScrollPositionChange/);
});
test("routes the builtin /model command through get_state and set_model", () => {
  const slashSource = commandsSource.slice(
    commandsSource.indexOf("const handleBuiltinSlashCommand = useCallback"),
    commandsSource.indexOf("// Let AgentSession.prompt decide"),
  );
  const modelSource = slashSource.slice(
    slashSource.indexOf('case "model":'),
    slashSource.indexOf("default: {"),
  );

  assert.match(modelSource, /type: "get_state"/);
  assert.match(modelSource, /type: "set_model", provider, modelId/);
});

test("forwards TUI-rename/reload-plugins through the OMP prompt path", () => {
  const slashSource = commandsSource.slice(
    commandsSource.indexOf("const handleBuiltinSlashCommand = useCallback"),
    commandsSource.indexOf("// Let AgentSession.prompt decide"),
  );
  // /reload and /name were removed (not TUI commands); /rename and
  // /reload-plugins live in the OMP-executable forward list.
  assert.doesNotMatch(slashSource, /case "reload":/);
  assert.doesNotMatch(slashSource, /case "name":/);
  assert.match(catalogSource, /rename: true/);
  assert.match(catalogSource, /"reload-plugins": true/);
  assert.match(slashSource, /type: "prompt", message: text, streamingBehavior: "steer"/);
});

test("rejects unmapped slash commands with an explicit error", () => {
  const slashSource = commandsSource.slice(
    commandsSource.indexOf("const handleBuiltinSlashCommand = useCallback"),
    commandsSource.indexOf("// Let AgentSession.prompt decide"),
  );
  const defaultSource = slashSource.slice(
    slashSource.indexOf("default: {"),
  );

  assert.match(defaultSource, /OMP_EXECUTABLE_SLASH_COMMANDS\[commandName\]/);
  assert.match(defaultSource, /TUI_ONLY_SLASH_COMMANDS\[commandName\]/);
  assert.match(defaultSource, /return \{ handled: false \};/);
  assert.match(defaultSource, /handled: true, error: `Unknown command/);
});
