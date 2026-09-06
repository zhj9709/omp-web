"use client";

import { useState, useCallback, useRef, useEffect, useMemo, useReducer } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import { clearDraft } from "@/lib/draft-store";
import { useSetting, ensureSettingsLoaded } from "@/hooks/useSettings";
import {
  DEFAULT_QUEUE_MODES,
  type QueueModes,
} from "@/lib/queue-mode-preference";
import type { ToolPreset } from "@/lib/tool-presets";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { normalizeTodoPhases, type TodoPhase } from "@/lib/todos";
import type { GoalModeInfo } from "@/lib/goal";
import {
  INITIAL_STREAMING_STATE,
  streamReducer,
} from "@/lib/streaming-message";
import type { CompactResultInfo } from "@/lib/compaction-summary";
import { useNotices } from "./agent-session/notices";
import { useAgentPhase, useDeltaCoalescer, useSubagents } from "./agent-session/coalescers";
import { useExtensionUi } from "./agent-session/extension-ui";
import { useChatScroll } from "./agent-session/scroll";
import { useSessionLoader } from "./agent-session/session-loader";
import { useEventStream, BASH_STATE_RECONCILE_MS, delay } from "./agent-session/event-stream";
import { useSessionModels } from "./agent-session/models";
import { useNewSessionFlow } from "./agent-session/new-session";
import { useAgentCommands } from "./agent-session/commands";
import { useEventDispatcher } from "./agent-session/event-dispatcher";
import { normalizeQueuedMessages } from "./agent-session/types";
import type {
  AgentStateResponse,
  QueuedMessages,
  ThinkingLevelOption,
  UseAgentSessionOptions,
} from "./agent-session/types";

export type {
  AgentPhase,
  AttachedImage,
  BuiltinSlashCommandResult,
  ChatInputHandle,
  QueuedMessages,
  SessionData,
  SlashCommandInfo,
  ThinkingLevelOption,
  UseAgentSessionOptions,
} from "./agent-session/types";
export type { CompactResultInfo } from "@/lib/compaction-summary";
export type { NoticeItem, NoticeType } from "./agent-session/notices";

export function useAgentSession(opts: UseAgentSessionOptions) {
  const {
    session, sessionRunning, newSessionCwd, newSessionDraftKey, onAgentEnd, onAttentionNeeded, onSessionCreated, onSessionForked,
    modelsRefreshKey, onBranchDataChange, onSystemPromptChange, onSystemPromptLoaderChange, onSessionStatsPanelOpen,
  } = opts;

  // display.collapseCompacted is true by default; when the user disables it,
  // we ask the server for the full pre-compaction transcript. The hook
  // re-renders after SettingsConfig calls refreshSettings(), so toggling the
  // setting updates an already-mounted session live.
  //
  // `useSetting` returns `undefined` until the shared /api/config cache is
  // populated. We use that signal to skip the very first loadSession call —
  // it would otherwise ask the server for the collapsed transcript before we
  // know whether the user opted into expansion, then a subsequent reload
  // would silently replace the (correct) expanded messages with the
  // (incorrect) collapsed ones.
  const collapseCompacted = useSetting<boolean>("display.collapseCompacted");
  const expandCompaction: boolean | undefined =
    collapseCompacted === undefined ? undefined : collapseCompacted === false;

  // isNew must reflect an *explicit* draft intent from above, not just the
  // shape of props. AppShell sets newSessionDraftKey in exactly the paths
  // that create a draft: handleNewSession (button / Cmd+Alt+N / slash /
  // initial ?cwd= restore). Selecting an existing session, deleting the
  // current session, switching project, or restoring from URL — all of those
  // either pass session !== null, or pass newSessionDraftKey === null.
  // Without this gate, any transient window where session flips to null while
  // newSessionCwd still carries the old project's cwd (handleCwdChange, async
  // restoreWorkspaceContext, list refetch that nulls then rehydrates, etc.)
  // would silently route the next prompt into a freshly-spawned session via
  // ensureNewSession(), losing the conversation the user thought they were
  // continuing in.
  const isNew = session === null && newSessionCwd !== null && newSessionDraftKey !== null;
  const composerDraftKey = session?.id ?? newSessionDraftKey ?? undefined;

  const [streamState, dispatch] = useReducer(streamReducer, INITIAL_STREAMING_STATE);
  const [bashRunning, setBashRunning] = useState(false);
  const [pendingBash, setPendingBash] = useState<{ command: string; excludeFromContext: boolean } | null>(null);
  const [toolPreset, setToolPreset] = useState<ToolPreset>("default");
  const [fastModeEnabled, setFastModeEnabled] = useState(false);
  const [fastModeActive, setFastModeActive] = useState(false);
  const [queueModes, setQueueModes] = useState<QueueModes>(DEFAULT_QUEUE_MODES);
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [compactError, setCompactError] = useState<string | null>(null);
  const [compactResult, setCompactResult] = useState<CompactResultInfo | null>(null);
  const [todoPhases, setTodoPhases] = useState<TodoPhase[]>([]);
  const [goal, setGoal] = useState<GoalModeInfo | null>(null);
  const [sessionStatsOverride, setSessionStatsOverride] = useState<SessionStatsInfo | null>(null);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessages>({ steering: [], followUp: [] });


  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const sessionPropIdRef = useRef<string | null>(session?.id ?? null);
  const sessionRunningRef = useRef(Boolean(sessionRunning));
  const bashRunningRef = useRef(false);
  const bashRecoveryIdRef = useRef(0);
  const ttsrAbortPendingRef = useRef(false);
  // True from the moment message_end appended this run's complete assistant
  // message until agent_end consumes it — lets agent_end skip the redundant
  // full session reload (which re-renders every message and reads as a flash).
  const messagesTailCompleteRef = useRef(false);
  const executeBashRef = useRef<(command: string, excludeFromContext: boolean) => Promise<void> | undefined>(undefined);
  const fastModeEnabledRef = useRef(false);
  const promptRunIdRef = useRef(0);
  const optimisticUserMessageKeyRef = useRef<string | null>(null);
  const draftKeyAliasesRef = useRef(new Map<string, string>());
  // toolCallId → concrete command text, populated from streamed toolcall_end
  // arguments so the activity bar can show the real command while it runs.
  const toolCommandByIdRef = useRef(new Map<string, string>());

  // --- composed state hooks ---------------------------------------------------
  const { notices, addNotice } = useNotices();

  const refreshTodos = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
      if (!res.ok) return;
      const d = await res.json() as { state?: AgentStateResponse };
      if (sessionIdRef.current !== sid) return;
      if (d.state?.todoPhases !== undefined) {
        setTodoPhases(normalizeTodoPhases(d.state.todoPhases));
      }
    } catch {
      // Best-effort refresh; the next state reconciliation will catch up.
    }
  }, [sessionIdRef]);

  const setTodos = useCallback(async (phases: TodoPhase[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const result = await sendAgentCommand<{ todoPhases?: unknown }>(sid, {
      type: "set_todos",
      phases,
    });
    setTodoPhases(normalizeTodoPhases(result?.todoPhases ?? phases));
  }, [sessionIdRef]);

  const { agentPhase, queuePhaseUpdate, flushPendingPhase, commitAgentPhase } = useAgentPhase();
  const { flushPendingDeltas, pushDelta } = useDeltaCoalescer(dispatch);
  const {
    subagents, subagentsUnavailable, setSubagentsUnavailable, queueSubagentEvent, refreshSubagents, loadSubagentTranscript,
  } = useSubagents(sessionIdRef);
  const setToolPresetState = opts.setToolPreset ?? setToolPreset;
  const models = useSessionModels({
    isNew,
    newSessionCwd,
    sessionCwd: session?.cwd,
    modelsRefreshKey,
    sessionIdRef,
  });
  const {
    modelNames, modelList, modelRoles, modelError, modelScopeWarnings,
    modelThinkingLevels, modelThinkingLevelMaps,
    newSessionModel, newSessionDefaultModel,
    thinkingLevel, setThinkingLevel,
    pendingModel, setPendingModel, currentModelOverride, setCurrentModelOverride,
    modelSwitching, setNewSessionDefaultModel,
    newSessionModelOverrideRef, thinkingLevelOverrideRef, modelSwitchPendingRef,
    loadModels,
  } = models;
  const loaderApi = useSessionLoader({
    initialLoading: !isNew,
    sessionIdRef,
    promptRunIdRef,
    messagesTailCompleteRef,
    modelSwitchPendingRef,
    setCurrentModelOverride,
    setToolPresetState,
    setThinkingLevel,
    setContextUsage,
    setSystemPrompt,
    setQueuedMessages,
    setFastModeEnabled,
    setFastModeActive,
    setQueueModes,
    setTodoPhases,
    setSubagentsUnavailable,
    expandCompaction,
  });
  const {
    data, setData, loading, error, activeLeafId, setActiveLeafId, messages, setMessages, entryIds,
    loadSession, loadTools,
  } = loaderApi;
  const streamApi = useEventStream({
    sessionIdRef,
    sessionPropIdRef,
    sessionRunningRef,
    promptRunIdRef,
    optimisticUserMessageKeyRef,
    sessionId: session?.id,
    sessionRunning,
    loadSession,
    onAgentEnd,
    commitAgentPhase,
    flushPendingPhase,
    flushPendingDeltas,
    dispatch,
    setSubagentsUnavailable,
    setQueuedMessages,
    setContextUsage,
    setSystemPrompt,
  });
  const {
    agentRunning, setAgentRunning, agentRunningRef, sdkAgentActiveRef, rpcPromptPendingRef,
    retryInfo, isCompacting, setIsCompacting,
    handleAgentEventRef, sessionHookMountedRef,
    cancelEventStreamGrace, closeEvents, maintainEventsConnected,
    waitForPromptSettlement,
  } = streamApi;
  const {
    extensionDialog, extensionCustomUi, extensionStatuses, extensionWidgets,
    respondToExtensionUi, sendExtensionCustomInput, handleExtensionUiRequest,
  } = useExtensionUi({ sessionIdRef, chatInputRef: opts.chatInputRef, onAttentionNeeded, addNotice });
  const {
    promptAnchorActive, setPromptAnchorActive,
    initialScrollDoneRef, lastUserMsgRef, pendingScrollToUserRef, isNearBottomRef,
    liveFollowFrameRef, promptAnchorPinTopRef,
    messagesEndRef, scrollContainerRef,
    scrollToBottom, scrollUserMsgToTop,
  } = useChatScroll({ agentRunningRef, messages, loading, agentRunning });
  const {
    ensureNewSession, promoteNewSession, ensuringNewSessionRef, newSessionPromotedRef,
  } = useNewSessionFlow({
    isNew,
    newSessionCwd,
    newSessionDraftKey,
    sessionIdRef,
    draftKeyAliasesRef,
    toolPreset,
    queueModes,
    setQueueModes,
    newSessionModelOverrideRef,
    thinkingLevelOverrideRef,
    setPendingModel,
    setNewSessionDefaultModel,
    setThinkingLevel,
    onSessionCreated,
    chatInputRef: opts.chatInputRef,
  });
  const commands = useAgentCommands({
    isNew,
    session,
    newSessionCwd,
    newSessionDraftKey,
    composerDraftKey: composerDraftKey,
    sessionIdRef,
    promptRunIdRef,
    optimisticUserMessageKeyRef,
    draftKeyAliasesRef,
    executeBashRef,
    bashRunningRef,
    setBashRunning,
    setPendingBash,
    stream: streamApi,
    loader: loaderApi,
    models,
    sessionFlow: {
      ensureNewSession,
      promoteNewSession,
      ensuringNewSessionRef,
      newSessionPromotedRef,
    },
    addNotice,
    pendingScrollToUserRef,
    setPromptAnchorActive,
    commitAgentPhase,
    flushPendingDeltas,
    flushPendingPhase,
    dispatch,
    toolPreset,
    setToolPresetState,
    queueModes,
    setQueueModes,
    fastModeEnabledRef,
    setFastModeEnabled,
    setFastModeActive,
    isCompacting,
    setIsCompacting,
    setCompactError,
    setCompactResult,
    setSessionStatsOverride,
    setQueuedMessages,
    setSystemPrompt,
    onSessionForked,
    onSessionStatsPanelOpen,
    onOpenSettings: opts.onOpenSettings,
    onOpenNewSession: opts.onOpenNewSession,
    onOpenPlugins: opts.onOpenPlugins,
    onOpenCollab: opts.onOpenCollab,
    chatInputRef: opts.chatInputRef,
  });
  const {
    forkingEntryId, setForkingEntryId, isHandingOff, handoffError,
    slashCommands, slashCommandsLoading,
    loadSystemPrompt, loadSlashCommands,
    handleSend, handleAbort, handleFork, handleNavigate, handleLeafChange,
    handleModelChange, handleModelRoleChange,
    handleCompact, handleHandoff,
    handleBuiltinSlashCommand,
    handleSteer, handleFollowUp, handlePromptWithStreamingBehavior,
    handleAbortCompaction, handleRecallQueue,
    handleThinkingLevelChange, handleFastModeChange, handleToolPresetChange, handleQueueModeChange,
  } = commands;
  const { handleAgentEvent } = useEventDispatcher({
    sessionIdRef,
    promptRunIdRef,
    optimisticUserMessageKeyRef,
    ttsrAbortPendingRef,
    messagesTailCompleteRef,
    toolCommandByIdRef,
    stream: streamApi,
    loader: loaderApi,
    addNotice,
    handleExtensionUiRequest,
    isNearBottomRef,
    pendingScrollToUserRef,
    liveFollowFrameRef,
    scrollToBottom,
    commitAgentPhase,
    flushPendingPhase,
    queuePhaseUpdate,
    pushDelta,
    flushPendingDeltas,
    dispatch,
    queueSubagentEvent,
    refreshSubagents,
    setQueuedMessages,
    setContextUsage,
    setSystemPrompt,
    setSubagentsUnavailable,
    setTodoPhases,
    setGoal,
    setCompactError,
    setCompactResult,
    refreshTodos,
    onAgentEnd,
  });
  handleAgentEventRef.current = handleAgentEvent;


  sessionPropIdRef.current = session?.id ?? null;
  sessionRunningRef.current = Boolean(sessionRunning);

  // Load persisted goal-mode state when the session changes; live updates
  // arrive via goal_updated events.
  useEffect(() => {
    const sid = session?.id ?? sessionIdRef.current;
    if (!sid) return;
    let cancelled = false;
    fetch(`/api/sessions/${encodeURIComponent(sid)}/goal`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() as Promise<{ goal?: GoalModeInfo | null }> : null))
      .then((d) => {
        if (!cancelled && sessionIdRef.current === sid) setGoal(d?.goal ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [session?.id]);

  const currentModel = currentModelOverride ?? data?.context.model ?? pendingModel ?? null;
  const displayModel = isNew ? (newSessionModel ?? newSessionDefaultModel) : currentModel;

  const sessionStats = useMemo(() => {
    if (sessionStatsOverride) {
      return { ...sessionStatsOverride, totalActiveMs: data?.totalActiveMs };
    }
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    let cost = 0;
    let userMessages = 0;
    let assistantMessages = 0;
    let toolResults = 0;
    let toolCalls = 0;
    for (const msg of messages) {
      if (msg.role === "user") userMessages += 1;
      if (msg.role === "toolResult") toolResults += 1;
      if (msg.role !== "assistant") continue;
      assistantMessages += 1;
      const u = (msg as import("@/lib/types").AssistantMessage).usage;
      toolCalls += (msg as import("@/lib/types").AssistantMessage).content.filter((c) => c.type === "toolCall").length;
      if (!u) continue;
      tokens.input += u.input ?? 0;
      tokens.output += u.output ?? 0;
      tokens.cacheRead += u.cacheRead ?? 0;
      tokens.cacheWrite += u.cacheWrite ?? 0;
      cost += u.cost?.total ?? 0;
    }
    tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
    if (tokens.total === 0 && messages.length === 0) return null;
    return {
      sessionFile: data?.filePath || undefined,
      sessionId: sessionIdRef.current ?? session?.id ?? "",
      sessionName: session?.name,
      userMessages,
      assistantMessages,
      toolCalls,
      toolResults,
      totalMessages: messages.length,
      tokens,
      cost,
      totalActiveMs: data?.totalActiveMs,
      ...(contextUsage ? { contextUsage } : {}),
    } satisfies SessionStatsInfo;
  }, [messages, sessionStatsOverride, contextUsage, data?.filePath, data?.totalActiveMs, session?.id, session?.name]);

  const waitForBashSettlement = useCallback(async (sid: string) => {
    const recoveryId = bashRecoveryIdRef.current + 1;
    bashRecoveryIdRef.current = recoveryId;

    while (
      bashRunningRef.current
      && bashRecoveryIdRef.current === recoveryId
      && sessionIdRef.current === sid
    ) {
      await delay(BASH_STATE_RECONCILE_MS);
      try {
        const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
        if (!res.ok) continue;
        const data = await res.json() as { state?: AgentStateResponse };
        if (data.state?.isBashRunning) continue;

        await loadSession(sid);
        if (bashRecoveryIdRef.current !== recoveryId || sessionIdRef.current !== sid) return;
        bashRunningRef.current = false;
        setBashRunning(false);
        setPendingBash(null);
        return;
      } catch {
        // Keep polling while the page is mounted; network recovery is transparent.
      }
    }
  }, [loadSession]);

  // Load session on mount
  useEffect(() => {
    sessionHookMountedRef.current = true;
    if (session) {
      sessionIdRef.current = session.id;
      // Defer the first loadSession until the settings cache is populated.
      // Otherwise loadSession reads expandCompactionRef as `undefined` (i.e.
      // "treat as collapsed"), pulls the folded transcript, and a later
      // effect-driven reload overwrites it with the unfolded one — a flash
      // of collapsed content followed by the correct view.
      void ensureSettingsLoaded().then(() => {
        if (!sessionHookMountedRef.current) return;
        if (sessionIdRef.current !== session.id) return;
        loadSession(session.id, true, true).then((agentState) => {
          if (agentState?.running) {
            loadTools(session.id);
            if (agentState.state?.isStreaming || agentState.state?.isPromptRunning) {
              sdkAgentActiveRef.current = Boolean(agentState.state.isStreaming);
              rpcPromptPendingRef.current = Boolean(agentState.state.isPromptRunning);
              agentRunningRef.current = true;
              setAgentRunning(true);
              commitAgentPhase(agentState.state.isStreaming ? { kind: "waiting_model" } : { kind: "running_command" });
              dispatch({ type: "start" });
              void maintainEventsConnected(session.id);
              if (!agentState.state.isStreaming && agentState.state.isPromptRunning) {
                void waitForPromptSettlement(session.id);
              }
            }
            if (agentState.state?.isBashRunning) {
              bashRunningRef.current = true;
              setBashRunning(true);
              void waitForBashSettlement(session.id);
            }
          }
          if (agentState?.state) {
            if (agentState.state.isCompacting !== undefined) setIsCompacting(agentState.state.isCompacting);
            if (agentState.state.contextUsage !== undefined) setContextUsage(agentState.state.contextUsage ?? null);
            if (agentState.state.systemPrompt !== undefined) setSystemPrompt(agentState.state.systemPrompt ?? null);
            if (agentState.state.thinkingLevel !== undefined) setThinkingLevel((agentState.state.thinkingLevel as ThinkingLevelOption) ?? "auto");
            // extensionStatuses/extensionWidgets omitted: snapshots always
            // report empty arrays; SSE events are the only source.
            if (agentState.state.queuedMessages !== undefined) setQueuedMessages(normalizeQueuedMessages(agentState.state.queuedMessages));
          }
        });
      });
    }
    return () => {
      sessionHookMountedRef.current = false;
      const abandonedDraftKey = isNew ? newSessionDraftKey : null;
      if (abandonedDraftKey) {
        queueMicrotask(() => {
          // Reads the latest mounted/promoted refs on purpose.
          // eslint-disable-next-line react-hooks/exhaustive-deps
          if (!sessionHookMountedRef.current && !newSessionPromotedRef.current) {
            clearDraft(abandonedDraftKey);
          }
        });
      }
      bashRecoveryIdRef.current += 1;
      cancelEventStreamGrace();
      closeEvents();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onSystemPromptChange?.(systemPrompt);
  }, [systemPrompt, onSystemPromptChange]);

  useEffect(() => {
    onSystemPromptLoaderChange?.(loadSystemPrompt);
    return () => onSystemPromptLoaderChange?.(null);
  }, [loadSystemPrompt, onSystemPromptLoaderChange]);

  useEffect(() => {
    if (!onBranchDataChange) return;
    onBranchDataChange(data?.tree ?? [], activeLeafId, handleLeafChange);
  }, [data?.tree, activeLeafId, handleLeafChange, onBranchDataChange]);

  // Load model list
  useEffect(() => {
    const controller = new AbortController();
    loadModels(controller.signal).catch((e) => {
      if (e instanceof DOMException && e.name === "AbortError") return;
    });
    return () => controller.abort();
  }, [loadModels, modelsRefreshKey]);

  useEffect(() => {
    if (!compactResult) return;
    const t = setTimeout(() => setCompactResult(null), 6000);
    return () => clearTimeout(t);
  }, [compactResult]);

  useEffect(() => {
    setSessionStatsOverride(null);
  }, [messages.length, contextUsage?.tokens, contextUsage?.percent, contextUsage?.contextWindow]);

  // When display.collapseCompacted changes after a session is already loaded,
  // refetch the session (and any cached context leaf) so the toggle takes
  // effect without a page reload. Skip while the settings cache is still
  // loading — that race could otherwise replace the correct expanded
  // transcript with the collapsed one before useSetting settles.
  useEffect(() => {
    if (expandCompaction === undefined) return;
    const sid = session?.id;
    if (!sid) return;
    if (isNew) return;
    void loadSession(sid, false, false, promptRunIdRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandCompaction]);

  return {
    // State
    data, loading, error, activeLeafId, messages, entryIds, streamState,
    agentRunning, modelNames, modelList, modelRoles, modelError, modelScopeWarnings, modelThinkingLevels, modelThinkingLevelMaps, newSessionModel, toolPreset, thinkingLevel,
    fastModeEnabled, fastModeActive, queueModes,
    retryInfo, contextUsage, systemPrompt, forkingEntryId,
    isCompacting, compactError, compactResult, isHandingOff, handoffError, currentModel, displayModel, modelSwitching, sessionStats,
    slashCommands, slashCommandsLoading, queuedMessages, todoPhases, setTodos,
    subagents, subagentsUnavailable, refreshSubagents, loadSubagentTranscript,
    goal,
    notices, extensionDialog, extensionCustomUi, extensionStatuses, extensionWidgets, respondToExtensionUi, sendExtensionCustomInput,
    isAutoModelSelection: isNew && newSessionModel === null,
    agentPhase,
    isNew,
    promptAnchorActive,
    // Refs
    sessionIdRef, messagesEndRef, scrollContainerRef,
    lastUserMsgRef, pendingScrollToUserRef, initialScrollDoneRef,
    promptAnchorPinTopRef,
    // Actions
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange, handleModelRoleChange,
    handleCompact, handleHandoff, handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    handleRecallQueue,
    handleBuiltinSlashCommand,
    handleToolPresetChange, handleThinkingLevelChange, handleFastModeChange, handleQueueModeChange, loadTools, loadSlashCommands, setActiveLeafId, setData, setMessages,
    scrollToBottom, scrollUserMsgToTop,
    dispatch, setAgentRunning, setForkingEntryId,
    bashRunning, pendingBash,
    // Subscriptions
    handleAgentEventRef,
  };
}
