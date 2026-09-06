"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo, useReducer } from "react";
import type {
  AgentMessage,
  ExtensionUiRequest,
} from "@/lib/types";
import { projectIdentityKey } from "@/lib/project-identity";
import { normalizeToolCalls } from "@/lib/normalize";
import { AgentCommandError, isPromptRejectedError, sendAgentCommand } from "@/lib/agent-client";
import { clearDraft, rekeyDraft, restoreDraftSubmission } from "@/lib/draft-store";
import { getPreferredToolPreset, setPreferredToolPreset } from "@/lib/tool-preset-preference";
import { useSetting, ensureSettingsLoaded } from "@/hooks/useSettings";
import {
  DEFAULT_QUEUE_MODES,
  getPreferredQueueModes,
  setPreferredQueueModes,
  type QueueModes,
} from "@/lib/queue-mode-preference";
import { getToolNamesForPreset, isRestrictiveToolRequest, type ToolPreset } from "@/lib/tool-presets";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { normalizeTodoPhases, type TodoPhase } from "@/lib/todos";
import { normalizeSubagentEvent } from "@/lib/subagents";
import { normalizeGoalEvent, type GoalModeInfo } from "@/lib/goal";
import {
  OMP_EXECUTABLE_SLASH_COMMANDS,
  TUI_ONLY_SLASH_COMMANDS,
  mergeTuiOnlyCommands,
} from "@/lib/slash-command-catalog";
import { userMessageKey } from "@/lib/prompt-recovery";
import { extractToolCommand, getToolExecutionProgress, toolArgsDigest } from "@/lib/tool-execution-progress";
import { readCompactResult, type CompactCommandResult, type CompactResultInfo } from "@/lib/compaction-summary";
import {
  INITIAL_STREAMING_STATE,
  streamReducer,
  type ClientAssistantMessageEvent,
} from "@/lib/streaming-message";
import { useNotices } from "./agent-session/notices";
import { useAgentPhase, useDeltaCoalescer, useSubagents } from "./agent-session/coalescers";
import { useExtensionUi } from "./agent-session/extension-ui";
import { useChatScroll } from "./agent-session/scroll";
import { useSessionLoader } from "./agent-session/session-loader";
import { useEventStream, BASH_STATE_RECONCILE_MS, delay } from "./agent-session/event-stream";
import { normalizeQueuedMessages } from "./agent-session/types";
import type {
  AgentEvent,
  AgentStateResponse,
  AttachedImage,
  BuiltinSlashCommandResult,
  LastAssistantTextResponse,
  ModelEntry,
  ModelRoleEntry,
  ModelsResponse,
  QueuedMessages,
  SelectedModel,
  SlashCommandInfo,
  SlashCommandsResponse,
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

  const [streamState, dispatch] = useReducer(streamReducer, INITIAL_STREAMING_STATE);
  const [bashRunning, setBashRunning] = useState(false);
  const [pendingBash, setPendingBash] = useState<{ command: string; excludeFromContext: boolean } | null>(null);
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<ModelEntry[]>([]);
  const [modelRoles, setModelRoles] = useState<ModelRoleEntry[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelScopeWarnings, setModelScopeWarnings] = useState<string[]>([]);
  const [modelThinkingLevels, setModelThinkingLevels] = useState<Record<string, string[]>>({});
  const [modelThinkingLevelMaps, setModelThinkingLevelMaps] = useState<Record<string, Record<string, string | null>>>({});
  const [newSessionModel, setNewSessionModel] = useState<SelectedModel | null>(null);
  const [newSessionDefaultModel, setNewSessionDefaultModel] = useState<SelectedModel | null>(null);
  const [toolPreset, setToolPreset] = useState<ToolPreset>("default");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevelOption>("auto");
  const [fastModeEnabled, setFastModeEnabled] = useState(false);
  const [fastModeActive, setFastModeActive] = useState(false);
  const [queueModes, setQueueModes] = useState<QueueModes>(DEFAULT_QUEUE_MODES);
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const [currentModelOverride, setCurrentModelOverride] = useState<{ provider: string; modelId: string } | null>(null);
  const [pendingModel, setPendingModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [modelSwitching, setModelSwitching] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  const [isHandingOff, setIsHandingOff] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [compactResult, setCompactResult] = useState<CompactResultInfo | null>(null);
  const [slashCommands, setSlashCommands] = useState<SlashCommandInfo[]>([]);
  const [slashCommandsLoading, setSlashCommandsLoading] = useState(false);
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
  const ensuringNewSessionRef = useRef<Promise<string | null> | null>(null);
  const newSessionPromotedRef = useRef(false);
  const newSessionModelOverrideRef = useRef<SelectedModel | null>(null);
  const thinkingLevelOverrideRef = useRef<Exclude<ThinkingLevelOption, "auto"> | null>(null);
  const fastModeEnabledRef = useRef(false);
  const promptRunIdRef = useRef(0);
  const optimisticUserMessageKeyRef = useRef<string | null>(null);
  const modelSwitchPendingRef = useRef(false);
  const draftKeyAliasesRef = useRef(new Map<string, string>());
  // toolCallId → concrete command text, populated from streamed toolcall_end
  // arguments so the activity bar can show the real command while it runs.
  const toolCommandByIdRef = useRef(new Map<string, string>());

  // --- composed state hooks ---------------------------------------------------
  const { notices, addNotice } = useNotices();
  const { agentPhase, queuePhaseUpdate, flushPendingPhase, commitAgentPhase } = useAgentPhase();
  const { flushPendingDeltas, pushDelta } = useDeltaCoalescer(dispatch);
  const {
    subagents, subagentsUnavailable, setSubagentsUnavailable, queueSubagentEvent, refreshSubagents, loadSubagentTranscript,
  } = useSubagents(sessionIdRef);
  const setToolPresetState = opts.setToolPreset ?? setToolPreset;
  const {
    data, setData, loading, error, activeLeafId, setActiveLeafId, messages, setMessages, entryIds,
    loadSession, reloadSessionPreservingTail, loadContext, loadTools,
  } = useSessionLoader({
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
    agentRunning, setAgentRunning, agentRunningRef, sdkAgentActiveRef, rpcPromptPendingRef,
    retryInfo, setRetryInfo, isCompacting, setIsCompacting,
    handleAgentEventRef, sessionHookMountedRef,
    cancelEventStreamGrace, closeEvents, ensureEventsConnected, maintainEventsConnected,
    settleUiStage, notifyPromptStage, scheduleEventStreamClose,
    waitForPromptSettlement, reconcileAgentState,
  } = useEventStream({
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

  useLayoutEffect(() => {
    if (!isNew || sessionIdRef.current) return;
    const preferred = getPreferredToolPreset();
    // OMP RPC cannot honor restrictive presets; fall back to the platform
    // default so a stale stored preference never shows a fake guardrail.
    setToolPresetState(
      isRestrictiveToolRequest(getToolNamesForPreset(preferred)) ? "default" : preferred,
    );
  }, [isNew, setToolPresetState]);

  useLayoutEffect(() => {
    if (!isNew || sessionIdRef.current) return;
    setQueueModes(getPreferredQueueModes());
  }, [isNew]);

  const currentModel = currentModelOverride ?? data?.context.model ?? pendingModel ?? null;
  const displayModel = isNew ? (newSessionModel ?? newSessionDefaultModel) : currentModel;
  const composerDraftKey = session?.id ?? newSessionDraftKey ?? undefined;

  const resolveComposerDraftKey = useCallback((key: string | undefined) => {
    if (!key) return undefined;
    let resolved = key;
    const visited = new Set<string>();
    while (!visited.has(resolved)) {
      visited.add(resolved);
      const next = draftKeyAliasesRef.current.get(resolved);
      if (!next) break;
      resolved = next;
    }
    return resolved;
  }, []);

  const restoreSubmission = useCallback((
    text: string,
    images: AttachedImage[] | undefined,
    targetDraftKey: string | undefined,
  ) => {
    const draftImages = images?.map(({ data, mimeType }) => ({ data, mimeType }));
    const destinationDraftKey = resolveComposerDraftKey(targetDraftKey);
    if (
      !sessionHookMountedRef.current
      && !newSessionPromotedRef.current
      && targetDraftKey === newSessionDraftKey
    ) return;
    const input = opts.chatInputRef?.current;
    if (input) {
      input.restoreSubmission(text, draftImages, destinationDraftKey);
    } else if (destinationDraftKey) {
      restoreDraftSubmission(destinationDraftKey, text, draftImages);
    }
  }, [newSessionDraftKey, opts.chatInputRef, resolveComposerDraftKey, sessionHookMountedRef]);

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

  const promoteNewSession = useCallback((messageCount = 0, firstMessage = "(no messages)") => {
    const sid = sessionIdRef.current;
    if (!isNew || !newSessionCwd || !sid || newSessionPromotedRef.current) return;
    newSessionPromotedRef.current = true;
    const provisionalDraftKey = newSessionDraftKey;
    if (!provisionalDraftKey) return;
    if (provisionalDraftKey !== sid) {
      draftKeyAliasesRef.current.set(provisionalDraftKey, sid);
      const input = opts.chatInputRef?.current;
      if (input) input.rekeyDraft(provisionalDraftKey, sid);
      else rekeyDraft(provisionalDraftKey, sid);
    }
    onSessionCreated?.({
      id: sid,
      path: "",
      cwd: newSessionCwd,
      // Server-derived identities are unavailable for a session that is not on
      // disk yet, but the sidebar groups and pins by projectKey. Compute the
      // same identity the server would (canonical path form) so the transient
      // session lands in the existing project group instead of spawning a
      // duplicate one.
      projectRoot: newSessionCwd,
      projectKey: projectIdentityKey(newSessionCwd),
      name: undefined,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      messageCount,
      firstMessage,
      transient: true,
    }, provisionalDraftKey);
  }, [isNew, newSessionCwd, newSessionDraftKey, onSessionCreated, opts.chatInputRef]);

  const ensureNewSession = useCallback(async () => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (!isNew || !newSessionCwd) return sessionIdRef.current;
    if (ensuringNewSessionRef.current) return ensuringNewSessionRef.current;

    const promise = (async () => {
      // Only send explicit user overrides. The server resolves the current
      // enabledModels scope atomically with AgentSession construction.
      const selectedModel = newSessionModelOverrideRef.current;
      const selectedThinkingLevel = thinkingLevelOverrideRef.current;
      if (selectedModel) setPendingModel(selectedModel);
      const toolNames = getToolNamesForPreset(toolPreset);
      const res = await fetch("/api/agent/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd: newSessionCwd,
          type: "ensure_session",
          toolNames,
          ...(selectedModel ? { provider: selectedModel.provider, modelId: selectedModel.modelId } : {}),
          ...(selectedThinkingLevel
            ? { thinkingLevel: selectedThinkingLevel }
            : {}),
          steeringMode: queueModes.steeringMode,
          followUpMode: queueModes.followUpMode,
          interruptMode: queueModes.interruptMode,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json() as {
        sessionId: string;
        model?: SelectedModel | null;
        thinkingLevel?: ThinkingLevelOption;
        steeringMode?: string;
        followUpMode?: string;
        interruptMode?: string;
      };
      const realId = result.sessionId;
      sessionIdRef.current = realId;
      if (result.model && newSessionModelOverrideRef.current === selectedModel) {
        setPendingModel(result.model);
        if (!selectedModel) setNewSessionDefaultModel(result.model);
      }
      if (
        result.thinkingLevel
        && thinkingLevelOverrideRef.current === selectedThinkingLevel
      ) {
        setThinkingLevel(result.thinkingLevel);
      }
      setQueueModes({
        steeringMode: (result.steeringMode as QueueModes["steeringMode"]) ?? queueModes.steeringMode,
        followUpMode: (result.followUpMode as QueueModes["followUpMode"]) ?? queueModes.followUpMode,
        interruptMode: (result.interruptMode as QueueModes["interruptMode"]) ?? queueModes.interruptMode,
      });
      return realId;
    })();

    ensuringNewSessionRef.current = promise;
    try {
      return await promise;
    } finally {
      ensuringNewSessionRef.current = null;
    }
  }, [isNew, newSessionCwd, toolPreset, queueModes]);

  // Opening the System panel is also allowed to initialize an otherwise dormant
  // session. This is deliberately a non-prompt command: it creates no message
  // or model run, but lets users inspect the exact prompt before sending one.
  const loadSystemPrompt = useCallback(async () => {
    const sid = sessionIdRef.current ?? await ensureNewSession();
    if (!sid) return;

    const state = await sendAgentCommand<AgentStateResponse>(sid, { type: "get_state" });
    if (!sessionHookMountedRef.current || sessionIdRef.current !== sid) return;
    setSystemPrompt(state.systemPrompt ?? "");
  }, [ensureNewSession, sessionHookMountedRef]);

  const loadSlashCommands = useCallback(async () => {
    const sid = sessionIdRef.current ?? await ensureNewSession();
    if (!sid) {
      setSlashCommands([]);
      return [] as SlashCommandInfo[];
    }
    setSlashCommandsLoading(true);
    try {
      const data = await sendAgentCommand<SlashCommandsResponse>(sid, { type: "get_commands" });
      const commands = mergeTuiOnlyCommands(data?.commands ?? []);
      setSlashCommands(commands);
      return commands;
    } catch (e) {
      console.error("Failed to load slash commands:", e);
      setSlashCommands([]);
      return [] as SlashCommandInfo[];
    } finally {
      setSlashCommandsLoading(false);
    }
  }, [ensureNewSession]);

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
  }, []);

  const setTodos = useCallback(async (phases: TodoPhase[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const result = await sendAgentCommand<{ todoPhases?: unknown }>(sid, {
      type: "set_todos",
      phases,
    });
    setTodoPhases(normalizeTodoPhases(result?.todoPhases ?? phases));
  }, []);

  const handleAgentEvent = useCallback((event: AgentEvent) => {
    // Flush any rAF-coalesced deltas before a non-delta event mutates streaming
    // state (snapshot/start/end), so stale deltas can't resurrect a finished bubble.
    if (event.type !== "message_update") flushPendingDeltas();
    switch (event.type) {
      case "connected": {
        dispatch({ type: "end" });
        if (event.isStreaming === true) {
          cancelEventStreamGrace();
          sdkAgentActiveRef.current = true;
          agentRunningRef.current = true;
          setAgentRunning(true);
          commitAgentPhase({ kind: "waiting_model" });
        }
        const sid = sessionIdRef.current;
        if (sid) void refreshSubagents(sid);
        break;
      }
      case "agent_start":
        cancelEventStreamGrace();
        sdkAgentActiveRef.current = true;
        agentRunningRef.current = true;
        setAgentRunning(true);
        commitAgentPhase({ kind: "waiting_model" });
        dispatch({ type: "start" });
        break;
      case "agent_end":
        ttsrAbortPendingRef.current = false;
        // One logical prompt can emit multiple agent_end events before retrying,
        // compacting, or continuing messages queued by extension handlers.
        // Keep the stream open until prompt_done/agent_settled and the idle grace.
        if (!agentRunningRef.current) break;
        flushPendingPhase();
        commitAgentPhase(null);
        setRetryInfo(null);
        dispatch({ type: "end" });
        // OMP marks the final agent_end of a turn with isTerminal=true (omitted
        // or false means more turns follow: retry, compaction, queued follow-up).
        // mirror the same flag the server uses to fire prompt_done, so the Stop
        // button drops the moment the answer is on screen instead of waiting for
        // an agent_settled that may arrive seconds later (or never, if the SSE
        // stream is torn down by the idle grace window).
        const isAgentEndTerminal = (event as { isTerminal?: unknown }).isTerminal !== false;
        if (isAgentEndTerminal && (sdkAgentActiveRef.current || rpcPromptPendingRef.current)) {
          sdkAgentActiveRef.current = false;
          settleUiStage();
        }
        if (sessionIdRef.current) {
          // A full session reload replaces every rendered message with the
          // defer-thinking variant, flipping layouts (inline thinking ->
          // deferred placeholder, streaming plain text -> full Markdown).
          // Skip it when message_end already appended the complete message —
          // the replacement is pure churn and reads as a flash.
          reloadSessionPreservingTail(sessionIdRef.current);
          fetch(`/api/agent/${encodeURIComponent(sessionIdRef.current)}`)
            .then((r) => r.json())
            .then((d: { state?: AgentStateResponse }) => {
              if (d.state?.contextUsage !== undefined) setContextUsage(d.state.contextUsage ?? null);
              if (d.state?.systemPrompt !== undefined) setSystemPrompt(d.state.systemPrompt ?? null);
              // extensionStatuses/extensionWidgets omitted: snapshots always
              // report empty arrays; SSE events are the only source.
              if (d.state?.subagentSubscription !== undefined) {
                setSubagentsUnavailable(!d.state.subagentSubscription.available);
              }
              // Aborted turns can leave messages queued in pi (delivered with the
              // next turn); dead wrapper (no state) means the queue is gone.
              setQueuedMessages(normalizeQueuedMessages(d.state?.queuedMessages));
            })
            .catch(() => {});
        }
        break;
      case "agent_settled": {
        ttsrAbortPendingRef.current = false;
        const agentWasActive = sdkAgentActiveRef.current;
        sdkAgentActiveRef.current = false;
        if (!agentWasActive || rpcPromptPendingRef.current) break;

        const sid = sessionIdRef.current;
        const wasRunning = settleUiStage();
        setIsCompacting(false);
        if (sid) {
          void reloadSessionPreservingTail(sid);
          scheduleEventStreamClose(sid);
        }
        if (wasRunning) onAgentEnd?.();
        break;
      }
      case "prompt_done":
        {
          const runId = promptRunIdRef.current;
          const promptWasPending = rpcPromptPendingRef.current;
          rpcPromptPendingRef.current = false;
          optimisticUserMessageKeyRef.current = null;
          const firstNotification = notifyPromptStage(runId);
          if (!promptWasPending && !firstNotification) break;

          const sid = sessionIdRef.current;
          if (sid) void reloadSessionPreservingTail(sid);
          // An extension-injected agent may already have started before the
          // command's prompt_done. Keep that active stage visible and let its
          // agent_settled event perform the next completion transition.
          if (!sdkAgentActiveRef.current) {
            settleUiStage();
            if (sid) scheduleEventStreamClose(sid);
          }
        }
        break;
      case "prompt_error":
        ttsrAbortPendingRef.current = false;
        addNotice({ type: "error", message: (event.errorMessage as string | undefined) ?? "Command failed" });
        break;
      case "extension_error":
        addNotice({
          type: "error",
          message: (event.error as string | undefined) ?? "Extension command failed",
        });
        break;
      case "command_output": {
        // OMP executed a slash command natively (agentInvoked: false) and
        // streams its terminal output here — e.g. /todo list, /usage show,
        // /dump. Render it as a command-output message so the user sees what
        // the command actually did, matching the TUI.
        const text = (event.text as string | undefined) ?? "";
        if (!text.trim()) break;
        setMessages((prev) => [...prev, {
          role: "custom",
          customType: "commandOutput",
          content: [{ type: "text", text }],
          display: true,
          timestamp: Date.now(),
        }]);
        if (isNearBottomRef.current) scrollToBottom("auto");
        break;
      }
      case "message_start":
      case "message_update": {
        // Ignore streaming events arriving after this run already finished
        // (e.g. SSE data buffered while the tab was frozen, flushed after
        // reconcile) — they would resurrect a ghost streaming bubble.
        if (!agentRunningRef.current) break;
        if (event.type === "message_start") {
          const msg = event.message as AgentMessage | undefined;
          if (msg?.role === "user") break;
          if (msg?.role === "assistant") {
            dispatch({ type: "snapshot", message: msg });
            if (msg.content.length > 0) { flushPendingPhase(); commitAgentPhase(null); }
          } else if (msg) {
            flushPendingPhase();
            commitAgentPhase(null);
          }
        } else {
          const delta = event.assistantMessageEvent as ClientAssistantMessageEvent | undefined;
          if (delta) {
            pushDelta(delta);
            // Coalesce phase changes per frame: text/tool deltas arrive at
            // token rate, and thinking deltas mark the model's reasoning stage.
            if (delta.type === "thinking_start" || delta.type === "thinking_delta") {
              queuePhaseUpdate(() => ({ kind: "thinking" }));
            } else if (delta.type !== "toolcall_start" && delta.type !== "toolcall_delta") {
              queuePhaseUpdate(() => null);
            }
            if (delta.type === "toolcall_end" && delta.toolCall) {
              const command = extractToolCommand(delta.toolCall.arguments);
              if (command) toolCommandByIdRef.current.set(delta.toolCall.id, command);
            }
          }
        }
        // Live-follow the streaming output only when the user is already near
        // the bottom of the message list. If they scrolled up, leave them there.
        if (!pendingScrollToUserRef.current && isNearBottomRef.current && liveFollowFrameRef.current === null) {
          // Defer the scroll so React has time to update the DOM with the new
          // streaming content; otherwise scrollIntoView may target stale layout.
          liveFollowFrameRef.current = requestAnimationFrame(() => {
            liveFollowFrameRef.current = null;
            if (isNearBottomRef.current) scrollToBottom("auto");
          });
        }
        break;
      }
      case "message_end": {
        // Same late-event guard: after reconcile finished this run,
        // loadSession already loaded this message from the session file —
        // appending it again would duplicate it.
        if (!agentRunningRef.current) break;
        const completed = event.message as AgentMessage | undefined;
        if (completed && completed.role === "user") {
          // Delivered steering/follow-up messages surface here as user
          // messages. The run's initial prompt also emits one, but handleSend
          // already appended it optimistically. Consume only the still-adjacent
          // optimistic bubble; later same-text queue deliveries must render.
          const delivered = normalizeToolCalls(completed);
          const deliveredKey = userMessageKey(delivered);
          const optimisticKey = optimisticUserMessageKeyRef.current;
          optimisticUserMessageKeyRef.current = null;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (optimisticKey && last?.role === "user" && userMessageKey(last) === optimisticKey) {
              return optimisticKey === deliveredKey
                ? prev
                : [...prev.slice(0, -1), delivered];
            }
            return [...prev, delivered];
          });
          // Queue deliveries arrive mid-run; keep the viewport pinned to the
          // latest message when the user is already at the bottom.
          if (isNearBottomRef.current) scrollToBottom("auto");
        } else if (completed) {
          // TTSR aborts the current assistant message mid-stream and immediately
          // retries with a rule reminder. The runtime discards the aborted partial
          // (default contextMode "discard"); suppress it so the retried message is
          // the only assistant output rendered. A user-initiated abort (Esc) has no
          // pending TTSR flag and still shows its partial output.
          const abortedDuringTtsr =
            ttsrAbortPendingRef.current &&
            completed.role === "assistant" &&
            completed.stopReason === "aborted";
          if (!abortedDuringTtsr) {
            setMessages((prev) => [...prev, normalizeToolCalls(completed)]);
            // Mark that this run's finished assistant message is already in the
            // list, so agent_end can skip the redundant full reload (flash).
            if (completed.role === "assistant") messagesTailCompleteRef.current = true;
          }
          if (completed.role === "assistant") ttsrAbortPendingRef.current = false;
        }
        dispatch({ type: "end" });
        queuePhaseUpdate(() => ({ kind: "waiting_model" }));
        break;
      }
      case "tool_execution_start": {
        const id = event.toolCallId as string;
        const name = event.toolName as string;
        // Terminal-style activity line shows the concrete thing being run
        // (e.g. the shell command), not just the generic tool name.
        const cachedCommand = toolCommandByIdRef.current.get(id);
        const input = event.toolCall && typeof event.toolCall === "object"
          ? (event.toolCall as Record<string, unknown>).input
          : null;
        // Activity-line detail priority: the model's own stated intent
        // (TUI-style "what am I doing", e.g. "列出当前目录文件") > the shell
        // command > a short arg digest (path/pattern/query) > tool name.
        const intent = typeof event.intent === "string" && event.intent.trim() ? event.intent.trim() : null;
        const args = event.args && typeof event.args === "object" ? event.args as Record<string, unknown> : null;
        const argsDigest = args ? toolArgsDigest(args) : null;
        const detail = cachedCommand
          ?? intent
          ?? argsDigest
          ?? (typeof event.command === "string" && event.command.trim() ? event.command : null)
          ?? (input && typeof input === "object" && typeof (input as Record<string, unknown>).command === "string"
            ? ((input as Record<string, unknown>).command as string)
            : undefined);
        queuePhaseUpdate((prev) => {
          const tools = prev?.kind === "running_tools" ? [...prev.tools] : [];
          if (!tools.some((t) => t.id === id)) tools.push({ id, name, ...(detail ? { detail } : {}) });
          return { kind: "running_tools", tools };
        });
        break;
      }
      case "tool_execution_update": {
        const id = event.toolCallId as string;
        const name = event.toolName as string;
        const progress = getToolExecutionProgress(event.partialResult);
        queuePhaseUpdate((prev) => {
          const tools = prev?.kind === "running_tools" ? [...prev.tools] : [];
          const existing = tools.find((tool) => tool.id === id);
          const updated = {
            id,
            name: name || existing?.name || "tool",
            progress: progress ?? existing?.progress,
            ...(existing?.detail ? { detail: existing.detail } : {}),
          };
          return {
            kind: "running_tools",
            tools: [...tools.filter((tool) => tool.id !== id), updated],
          };
        });
        break;
      }
      case "tool_execution_end": {
        const id = event.toolCallId as string;
        // Evict the command text cache so long sessions do not accumulate an
        // unbounded toolCallId → command map.
        if (id) toolCommandByIdRef.current.delete(id);
        queuePhaseUpdate((prev) => {
          if (prev?.kind !== "running_tools") return prev;
          const tools = prev.tools.filter((t) => t.id !== id);
          if (tools.length === 0) return { kind: "waiting_model" };
          return { kind: "running_tools", tools };
        });
        break;
      }
      case "queue_update":
        setQueuedMessages({
          steering: [...((event.steering as string[] | undefined) ?? [])],
          followUp: [...((event.followUp as string[] | undefined) ?? [])],
        });
        break;
      case "auto_retry_start":
        setRetryInfo({ attempt: event.attempt as number, maxAttempts: event.maxAttempts as number, errorMessage: event.errorMessage as string | undefined });
        break;
      case "auto_retry_end":
        setRetryInfo(null);
        break;
      case "ttsr_triggered": {
        // A TTSR (Time Traveling Stream Rule) matched mid-stream. OMP aborts the
        // current generation and immediately retries with a rule reminder, so
        // surface a notice and mark the aborted partial message for suppression.
        ttsrAbortPendingRef.current = true;
        const rules = Array.isArray(event.rules) ? event.rules : [];
        const names = rules.filter((rule): rule is string => typeof rule === "string");
        addNotice({
          type: "warning",
          message: names.length > 0
            ? `Stream rule triggered: ${names.join(", ")}`
            : "Stream rule triggered",
        });
        break;
      }
      case "auto_compaction_start":
      case "compaction_start":
        setIsCompacting(true);
        setCompactError(null);
        setCompactResult(null);
        break;
      case "auto_compaction_end":
      case "compaction_end":
        setIsCompacting(false);
        if (event.errorMessage) {
          setCompactError(event.errorMessage as string);
          setCompactResult(null);
        } else if (!event.aborted) {
          setCompactResult(readCompactResult(event.result, (event.reason as string | undefined) ?? "auto"));
          if (sessionIdRef.current) loadSession(sessionIdRef.current);
        }
        break;
      case "extension_ui_request":
        handleExtensionUiRequest(event as ExtensionUiRequest);
        break;
      case "todo_reminder":
      case "todo_auto_clear": {
        // The agent touched the todo list (reminder to act, or auto-cleared a
        // settled task). Re-sync the canonical phase list from OMP state.
        const sid = sessionIdRef.current;
        if (sid) void refreshTodos(sid);
        break;
      }
      case "subagent_lifecycle":
      case "subagent_progress":
      case "subagent_event": {
        const info = normalizeSubagentEvent(event);
        if (info) queueSubagentEvent(info);
        break;
      }
      case "goal_updated": {
        const goalInfo = normalizeGoalEvent(event as { goal?: unknown; state?: unknown });
        if (goalInfo) setGoal(goalInfo);
        break;
      }

    }
  }, [addNotice, agentRunningRef, cancelEventStreamGrace, commitAgentPhase, flushPendingDeltas, flushPendingPhase, handleExtensionUiRequest, isNearBottomRef, liveFollowFrameRef, loadSession, notifyPromptStage, onAgentEnd, pendingScrollToUserRef, pushDelta, queuePhaseUpdate, queueSubagentEvent, refreshSubagents, refreshTodos, reloadSessionPreservingTail, rpcPromptPendingRef, scheduleEventStreamClose, scrollToBottom, sdkAgentActiveRef, setAgentRunning, setIsCompacting, setMessages, setRetryInfo, setSubagentsUnavailable, settleUiStage]);
  handleAgentEventRef.current = handleAgentEvent;

  const handleSend = useCallback(async (message: string, images?: AttachedImage[]) => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage && !images?.length) return;
    if (agentRunningRef.current || bashRunningRef.current) {
      restoreSubmission(message, images, composerDraftKey);
      return;
    }
    const isSlashCommandPrompt = !images?.length && trimmedMessage.startsWith("/");

    const isBashCommand = !images?.length && trimmedMessage.startsWith("!");
    if (isBashCommand) {
      const isExcluded = trimmedMessage.startsWith("!!");
      const bashCmd = (isExcluded ? trimmedMessage.slice(2) : trimmedMessage.slice(1)).trim();
      if (!bashCmd) {
        restoreSubmission(message, images, composerDraftKey);
        return;
      }
      await executeBashRef.current?.(bashCmd, isExcluded);
      return;
    }

    const promptRunId = promptRunIdRef.current + 1;
    cancelEventStreamGrace();
    rpcPromptPendingRef.current = true;

    const imageBlocks = images?.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mimeType, data: img.data } }));
    const userMsg: AgentMessage = {
      role: "user",
      content: imageBlocks?.length
        ? [...(message.trim() ? [{ type: "text" as const, text: message }] : []), ...imageBlocks]
        : message,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    optimisticUserMessageKeyRef.current = userMessageKey(userMsg);
    promptRunIdRef.current = promptRunId;
    agentRunningRef.current = true;
    setAgentRunning(true);
    commitAgentPhase(isSlashCommandPrompt ? { kind: "running_command" } : { kind: "waiting_model" });
    flushPendingDeltas();
    dispatch({ type: "start" });
    pendingScrollToUserRef.current = true;
    setPromptAnchorActive(true);

    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    let sentSessionId: string | null = null;
    let promptRequestStarted = false;

    try {
      if (isNew && newSessionCwd) {
        const selectedModel = newSessionModel;
        const existingSid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
        const sid = existingSid ?? await ensureNewSession();

        if (!sid) throw new Error("Unable to create a session for the prompt");
        sentSessionId = sid;
        if (selectedModel) {
          setPendingModel(selectedModel);
          if (existingSid) {
            await sendAgentCommand(sid, { type: "set_model", provider: selectedModel.provider, modelId: selectedModel.modelId });
          }
        }
        await ensureEventsConnected(sid);
        promptRequestStarted = true;
        await sendAgentCommand(sid, {
          type: "prompt",
          message,
          ...(piImages?.length ? { images: piImages } : {}),
        });
        promoteNewSession(1, message);
      } else if (session) {
        sentSessionId = session.id;
        await ensureEventsConnected(session.id);
        promptRequestStarted = true;
        await sendAgentCommand(session.id, {
          type: "prompt",
          message,
          ...(piImages?.length ? { images: piImages } : {}),
        });
      } else {
        throw new Error("No active session for the prompt");
      }
      if (isSlashCommandPrompt && sentSessionId) {
        void waitForPromptSettlement(sentSessionId, promptRunId);
      }
    } catch (e) {
      console.error("Failed to send message:", e);
      const definitivelyRejected = !promptRequestStarted || isPromptRejectedError(e);
      // A transport/proxy failure after dispatch is ambiguous: the server may
      // have accepted the prompt before the response was lost. Keep SSE alive
      // until server state confirms the run is idle.
      if (!definitivelyRejected && sentSessionId) {
        void waitForPromptSettlement(sentSessionId, promptRunId);
        return;
      }
      rpcPromptPendingRef.current = false;
      setMessages((prev) => {
        const optimisticIndex = prev.lastIndexOf(userMsg);
        return optimisticIndex === -1
          ? prev
          : [...prev.slice(0, optimisticIndex), ...prev.slice(optimisticIndex + 1)];
      });
      addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
      restoreSubmission(message, images, composerDraftKey);
      optimisticUserMessageKeyRef.current = null;
      // Rejection only describes this submission. Another tab or an event we
      // missed may still have a real run active for the same session, so keep
      // its SSE connection until server state says the wrapper is idle.
      if (sentSessionId) {
        void reconcileAgentState(sentSessionId);
        return;
      }
      agentRunningRef.current = false;
      closeEvents();
      setAgentRunning(false);
      flushPendingPhase();
      commitAgentPhase(null);
      flushPendingDeltas();
      dispatch({ type: "end" });
    }
  }, [agentRunningRef, isNew, newSessionCwd, newSessionModel, session, ensureNewSession, ensureEventsConnected, promoteNewSession, waitForPromptSettlement, addNotice, cancelEventStreamGrace, closeEvents, commitAgentPhase, composerDraftKey, flushPendingDeltas, flushPendingPhase, pendingScrollToUserRef, reconcileAgentState, restoreSubmission, setAgentRunning, setMessages, setPromptAnchorActive, rpcPromptPendingRef]);

  const executeBash = useCallback(async (command: string, excludeFromContext: boolean) => {
    if (agentRunningRef.current || bashRunningRef.current) return;
    const inputText = `${excludeFromContext ? "!!" : "!"}${command}`;
    bashRunningRef.current = true;
    setPendingBash({ command, excludeFromContext });
    setBashRunning(true);
    try {
      const sid = sessionIdRef.current ?? session?.id ?? await ensureNewSession();
      if (!sid) throw new Error("Unable to create a session for the shell command");
      await sendAgentCommand(sid, {
        type: "bash",
        command,
        excludeFromContext,
      });
      await loadSession(sid);
      promoteNewSession(1, inputText);
    } catch (e) {
      console.error("Failed to execute shell command:", e);
      addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
      restoreSubmission(inputText, undefined, composerDraftKey);
    } finally {
      bashRunningRef.current = false;
      setPendingBash(null);
      setBashRunning(false);
    }
  }, [addNotice, agentRunningRef, composerDraftKey, ensureNewSession, loadSession, promoteNewSession, restoreSubmission, session]);
  executeBashRef.current = executeBash;

  const handleAbort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    if (bashRunningRef.current) {
      try {
        await sendAgentCommand(sid, { type: "abort_bash" });
      } catch (e) {
        console.error("Failed to abort bash:", e);
      }
      return;
    }
    try {
      await sendAgentCommand(sid, { type: "abort" });
    } catch (e) {
      console.error("Failed to abort:", e);
    }
  }, []);

  const handleFork = useCallback(async (entryId: string) => {
    if (bashRunningRef.current) return;
    const sid = sessionIdRef.current;
    if (!sid) return;
    setForkingEntryId(entryId);
    try {
      const result = await sendAgentCommand<{ cancelled?: boolean; newSessionId?: string }>(sid, {
        type: "fork",
        entryId,
      });
      const { cancelled, newSessionId } = result ?? {};
      if (!cancelled && newSessionId) {
        onSessionForked?.(newSessionId);
      }
    } catch (e) {
      addNotice({ type: "error", message: e instanceof Error ? e.message : String(e) });
      console.error("Fork failed:", e);
    } finally {
      setForkingEntryId(null);
    }
  }, [addNotice, onSessionForked]);

  const handleNavigate = useCallback(async (entryId: string) => {
    if (bashRunningRef.current) return;
    const sid = sessionIdRef.current;
    if (!sid) return;
    sendAgentCommand(sid, { type: "navigate_tree", targetId: entryId }).catch(() => {});
    setActiveLeafId(entryId);
    await loadContext(sid, entryId);
  }, [loadContext, setActiveLeafId]);

  const handleLeafChange = useCallback(async (leafId: string | null) => {
    if (bashRunningRef.current) return;
    setActiveLeafId(leafId);
    const sid = sessionIdRef.current;
    if (!sid) return;
    await loadContext(sid, leafId);
    if (leafId) {
      sendAgentCommand(sid, { type: "navigate_tree", targetId: leafId }).catch(() => {});
    }
  }, [loadContext, setActiveLeafId]);

  const handleModelChange = useCallback(async (provider: string, modelId: string) => {
    if (isNew) {
      const selectedModel = { provider, modelId };
      newSessionModelOverrideRef.current = selectedModel;
      setNewSessionModel(selectedModel);
      setPendingModel(selectedModel);
      const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
      if (!sid) return;
      try {
        await sendAgentCommand(sid, { type: "set_model", provider, modelId });
      } catch (e) {
        console.error("Failed to set model:", e);
      }
      return;
    }
    const sid = sessionIdRef.current;
    if (!sid || modelSwitchPendingRef.current) return;
    const target = { provider, modelId };
    const previousOverride = currentModelOverride;
    modelSwitchPendingRef.current = true;
    setCurrentModelOverride(target);
    setModelSwitching(true);
    try {
      await sendAgentCommand(sid, { type: "set_model", provider, modelId });
      // Pi persists model_change synchronously. Reload the canonical session so
      // the model, thinking level, and active leaf all advance together.
      modelSwitchPendingRef.current = false;
      await loadSession(sid);
    } catch (e) {
      console.error("Failed to set model:", e);
      modelSwitchPendingRef.current = false;
      setCurrentModelOverride(previousOverride);
      addNotice({
        type: "error",
        message: `Failed to switch model: ${e instanceof Error ? e.message : String(e)}`,
      });
      // A failed response can still follow a server-side write (for example, a
      // dropped connection), so let the session file settle the displayed model.
      await loadSession(sid);
    } finally {
      modelSwitchPendingRef.current = false;
      setModelSwitching(false);
    }
  }, [addNotice, currentModelOverride, isNew, loadSession, setNewSessionModel]);


  const handleCompact = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || isCompacting) return;
    setIsCompacting(true);
    setCompactError(null);
    setCompactResult(null);
    try {
      const result = await sendAgentCommand<CompactCommandResult>(sid, { type: "compact" });
      setCompactResult(readCompactResult(result, "manual"));
      await loadSession(sid, true);
    } catch (e) {
      setCompactError(e instanceof Error ? e.message : String(e));
      setCompactResult(null);
    } finally {
      setIsCompacting(false);
    }
  }, [isCompacting, loadSession, setIsCompacting]);

  const handleHandoff = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || isHandingOff) return;
    setIsHandingOff(true);
    setHandoffError(null);
    try {
      const result = await sendAgentCommand<{ sessionId?: string; savedPath?: string }>(
        sid,
        { type: "handoff" },
      );
      const newSessionId = result?.sessionId;
      if (newSessionId && newSessionId !== sid) {
        onSessionForked?.(newSessionId);
      } else {
        await loadSession(sid, true);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setHandoffError(message);
      addNotice({ type: "error", message });
    } finally {
      setIsHandingOff(false);
    }
  }, [isHandingOff, loadSession, onSessionForked, addNotice]);

  const loadModels = useCallback(async (signal?: AbortSignal) => {
    const modelCwd = newSessionCwd ?? session?.cwd ?? "";
    const modelsUrl = modelCwd ? `/api/models?cwd=${encodeURIComponent(modelCwd)}` : "/api/models";
    const res = await fetch(modelsUrl, signal ? { signal } : undefined);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json() as ModelsResponse;
    setModelNames(d.models);
    setModelError(d.modelError ?? null);
    setModelScopeWarnings(d.modelScopeWarnings ?? []);
    setModelThinkingLevels(d.thinkingLevels ?? {});
    setModelThinkingLevelMaps(d.thinkingLevelMaps ?? {});
    const nextModelList = d.modelList ?? [];
    setModelList(nextModelList);
    setModelRoles(d.modelRoles ?? []);
    if (isNew && !sessionIdRef.current) {
      const match = d.defaultModel
        ? nextModelList.find((m) => m.id === d.defaultModel?.modelId && m.provider === d.defaultModel?.provider)
        : undefined;
      const displayModel = match ?? nextModelList[0];
      setNewSessionDefaultModel(displayModel ? { provider: displayModel.provider, modelId: displayModel.id } : null);
      // An `enabledModels` pattern may pin a thinking level (`anthropic/*:high`).
      // Like pi, apply it to the model a new session starts with.
      const pinned = displayModel && d.thinkingLevelPins?.[`${displayModel.provider}/${displayModel.id}`];
      if (thinkingLevelOverrideRef.current === null) {
        setThinkingLevel((pinned as ThinkingLevelOption | undefined) ?? "auto");
      }
    }
  }, [isNew, newSessionCwd, session?.cwd]);

  const handleBuiltinSlashCommand = useCallback(async (text: string): Promise<BuiltinSlashCommandResult> => {
    if (!text.startsWith("/")) return { handled: false };
    const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
    if (!match) return { handled: false };

    const [, commandName, rawArgs = ""] = match;
    const args = rawArgs.trim();
    const sid = sessionIdRef.current ?? await ensureNewSession();
    const complete = (result: BuiltinSlashCommandResult): BuiltinSlashCommandResult => {
      if (!result.handled) return result;
      if (result.error) {
        addNotice({ type: "error", message: result.error });
      } else if (result.action !== "openSessionStats") {
        addNotice({ type: "success", message: result.message ?? "Command completed" });
      }
      return result;
    };

    try {
      switch (commandName) {
        case "compact": {
          if (!sid || isCompacting) return complete({ handled: true, error: "No active session to compact" });
          setIsCompacting(true);
          setCompactError(null);
          setCompactResult(null);
          const result = await sendAgentCommand<CompactCommandResult>(sid, {
            type: "compact",
            ...(args ? { customInstructions: args } : {}),
          });
          setCompactResult(readCompactResult(result, "manual"));
          if (await loadSession(sid, true)) promoteNewSession();
          return complete({ handled: true, message: "Compacted context" });
        }

        case "session": {
          if (!sid) return complete({ handled: true, error: "No active session" });
          const stats = await sendAgentCommand<SessionStatsInfo>(sid, { type: "get_session_stats" });
          if (stats) {
            setSessionStatsOverride(stats);
          }
          onSessionStatsPanelOpen?.();
          return complete({ handled: true, action: "openSessionStats" });
        }

        case "copy": {
          if (!sid) return complete({ handled: true, error: "No active session" });
          const data = await sendAgentCommand<LastAssistantTextResponse>(sid, { type: "get_last_assistant_text" });
          const textToCopy = data?.text ?? "";
          if (!textToCopy) return complete({ handled: true, error: "No assistant message to copy" });
          await navigator.clipboard.writeText(textToCopy);
          return complete({ handled: true, message: "Copied last assistant message" });
        }

        case "model": {
          if (!sid) return complete({ handled: true, error: "No active session" });
          if (!args) {
            const state = await sendAgentCommand<{ model?: { provider: string; id: string } }>(sid, { type: "get_state" });
            const model = state?.model;
            if (!model?.provider || !model?.id) return complete({ handled: true, error: "No model selected" });
            return complete({ handled: true, message: `Current model: ${model.provider}/${model.id}` });
          }
          const slashIdx = args.indexOf("/");
          if (slashIdx <= 0 || slashIdx >= args.length - 1) {
            return complete({ handled: true, error: "Usage: /model <provider>/<modelId>" });
          }
          const provider = args.slice(0, slashIdx);
          const modelId = args.slice(slashIdx + 1);
          await sendAgentCommand(sid, { type: "set_model", provider, modelId });
          if (await loadSession(sid, true)) promoteNewSession();
          return complete({ handled: true, message: `Model set to ${provider}/${modelId}` });
        }

        case "settings":
        case "setup":
        case "providers": {
          opts.onOpenSettings?.();
          return complete({ handled: true, message: "Opened settings" });
        }

        case "new": {
          const cwd = session?.cwd ?? newSessionCwd;
          if (!cwd) return complete({ handled: true, error: "No working directory for a new session" });
          opts.onOpenNewSession?.(cwd);
          return complete({ handled: true, message: "Started a new session" });
        }

        case "switch": {
          if (!sid) return complete({ handled: true, error: "No active session" });
          const model = await sendAgentCommand<{ id?: string; provider?: string }>(sid, { type: "cycle_model" });
          if (model?.id && model.provider) {
            await loadSession(sid, true);
            return complete({ handled: true, message: `Switched model to ${model.provider}/${model.id}` });
          }
          return complete({ handled: true, error: "No next model available" });
        }

        case "extensions":
        case "status": {
          opts.onOpenPlugins?.();
          return complete({ handled: true, message: "Opened extensions" });
        }

        case "collab": {
          opts.onOpenCollab?.();
          return complete({ handled: true, message: "Opened collaboration" });
        }

        case "handoff": {
          if (!sid) return complete({ handled: true, error: "No active session" });
          await handleHandoff();
          return complete({ handled: true, message: "Handing off the session" });
        }

        case "quit":
        case "q": {
          return complete({ handled: true, message: "Close this browser tab to quit; the session keeps running server-side" });
        }

        case "resume": {
          return complete({ handled: true, message: "Pick a session from the sidebar to resume it" });
        }

        default: {
          // OMP intercepts registered slash commands in text mode (agentInvoked:
          // false) and streams their terminal output via command_output events —
          // the same behavior as the TUI. Forward natively-executable builtins
          // directly (no user message is recorded, matching the TUI). Keep the
          // agent event stream open so command_output reaches the UI; the idle
          // grace closes it once OMP reports the prompt no longer running.
          if (OMP_EXECUTABLE_SLASH_COMMANDS[commandName]) {
            if (!sid) return complete({ handled: true, error: "No active session for the command" });
            cancelEventStreamGrace();
            agentRunningRef.current = true;
            await ensureEventsConnected(sid);
            await sendAgentCommand(sid, { type: "prompt", message: text, streamingBehavior: "steer" });
            agentRunningRef.current = false;
            scheduleEventStreamClose(sid);
            return { handled: true };
          }
          if (TUI_ONLY_SLASH_COMMANDS[commandName]) {
            return complete({ handled: true, error: `/${commandName} is a TUI-only command — use the web UI instead` });
          }
          // Non-builtin commands (skill/extension/custom/file/mcp_prompt) go
          // through the normal prompt path: OMP expands/executes them and the
          // agent (or extension) produces visible messages.
          if (slashCommands.some((c) => c.name === commandName && c.source !== "builtin")) {
            return { handled: false };
          }
          return complete({ handled: true, error: `Unknown command: /${commandName}` });
        }
      }
    } catch (e) {
      return complete({ handled: true, error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (commandName === "compact") setIsCompacting(false);
    }
  }, [addNotice, agentRunningRef, cancelEventStreamGrace, ensureEventsConnected, ensureNewSession, handleHandoff, isCompacting, loadSession, promoteNewSession, onSessionStatsPanelOpen, opts.onOpenCollab, opts.onOpenNewSession, opts.onOpenPlugins, opts.onOpenSettings, scheduleEventStreamClose, setIsCompacting, session?.cwd, newSessionCwd, slashCommands]);

  // Let AgentSession.prompt decide atomically whether to queue against the
  // current run or start a new turn if it settled while the request was in
  // flight. Direct steer/followUp calls can strand a message in an idle queue.
  const sendStreamingPrompt = useCallback(async (
    message: string,
    behavior: "steer" | "followUp",
    images?: AttachedImage[],
  ) => {
    const sid = sessionIdRef.current;
    const restore = () => restoreSubmission(message, images, composerDraftKey);
    if (!sid) {
      restore();
      addNotice({ type: "error", message: "No active session for the queued message" });
      return;
    }
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "prompt",
        message,
        streamingBehavior: behavior,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to submit streaming prompt:", e);
      // A transport failure after dispatch is ambiguous: the server may have
      // accepted the queued prompt before the response was lost. Restoring in
      // that case would invite a duplicate turn.
      if (isPromptRejectedError(e)) restore();
      addNotice({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [addNotice, composerDraftKey, restoreSubmission]);

  const handleSteer = useCallback(async (message: string, images?: AttachedImage[]) => {
    await sendStreamingPrompt(message, "steer", images);
  }, [sendStreamingPrompt]);

  const handlePromptWithStreamingBehavior = useCallback(async (
    message: string,
    behavior: "steer" | "followUp",
    images?: AttachedImage[],
  ) => {
    await sendStreamingPrompt(message, behavior, images);
  }, [sendStreamingPrompt]);

  const handleFollowUp = useCallback(async (message: string, images?: AttachedImage[]) => {
    await sendStreamingPrompt(message, "followUp", images);
  }, [sendStreamingPrompt]);

  const handleAbortCompaction = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort_compaction" });
    } catch (e) {
      console.error("Failed to abort compaction:", e);
      const message = e instanceof AgentCommandError && e.code === "capability_unavailable"
        ? (e.message || "Aborting compaction is not supported in OMP RPC mode.")
        : "Failed to abort compaction";
      addNotice({ type: "error", message });
    }
  }, [addNotice]);

  const handleRecallQueue = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const result = await sendAgentCommand<{ steering?: string[]; followUp?: string[] }>(sid, { type: "clear_queue" });
      // clearQueue also emits an empty queue_update, but that only reaches us
      // while SSE is connected — clear locally so idle recalls update the UI.
      setQueuedMessages({ steering: [], followUp: [] });
      const texts = [...(result?.steering ?? []), ...(result?.followUp ?? [])];
      if (texts.length > 0) {
        opts.chatInputRef?.current?.prependText(texts.join("\n\n"));
      }
    } catch (e) {
      console.error("Failed to recall queued messages:", e);
      const message = e instanceof AgentCommandError && e.code === "capability_unavailable"
        ? (e.message || "Clearing queued messages is not supported in OMP RPC mode.")
        : "Failed to recall queued messages";
      addNotice({ type: "error", message });
    }
  }, [opts.chatInputRef, addNotice]);

  const handleThinkingLevelChange = useCallback(async (level: ThinkingLevelOption) => {
    setThinkingLevel(level);
    if (isNew && !sessionIdRef.current) {
      thinkingLevelOverrideRef.current = level === "auto" ? null : level;
    }
    if (level === "auto") return; // "auto" leaves pi's current setting untouched
    const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_thinking_level", level });
    } catch (e) {
      console.error("Failed to set thinking level:", e);
    }
  }, [isNew]);
  const handleModelRoleChange = useCallback(async (roleName: string) => {
    const role = modelRoles.find((r) => r.name === roleName);
    if (!role) return;
    await handleModelChange(role.provider, role.modelId);
    if (role.thinkingLevel && role.thinkingLevel !== "auto") {
      await handleThinkingLevelChange(role.thinkingLevel as ThinkingLevelOption);
    }
  }, [modelRoles, handleModelChange, handleThinkingLevelChange]);

  const handleFastModeChange = useCallback(async (enabled: boolean) => {
    const previous = fastModeEnabledRef.current;
    fastModeEnabledRef.current = enabled;
    setFastModeEnabled(enabled);
    const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
    if (!sid) return;
    try {
      const result = await sendAgentCommand<{ enabled: boolean; active: boolean }>(
        sid,
        { type: "set_fast_mode", enabled },
      );
      const nextEnabled = result?.enabled ?? enabled;
      fastModeEnabledRef.current = nextEnabled;
      setFastModeEnabled(nextEnabled);
      setFastModeActive(result?.active ?? enabled);
    } catch (e) {
      console.error("Failed to set fast mode:", e);
      // Revert the optimistic toggle so the UI reflects the actual session state.
      fastModeEnabledRef.current = previous;
      setFastModeEnabled(previous);
    }
  }, []);

  const handleToolPresetChange = useCallback(async (preset: ToolPreset) => {
    const toolNames = getToolNamesForPreset(preset);
    const previousPreset = toolPreset;
    setPreferredToolPreset(preset);
    setToolPresetState(preset);
    const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
    if (!sid) {
      // New session: the preset is applied at creation. OMP RPC cannot honor
      // restrictive presets, so reject them immediately instead of showing a
      // guardrail that will never be enforced.
      if (isRestrictiveToolRequest(toolNames)) {
        setPreferredToolPreset(previousPreset);
        setToolPresetState(previousPreset);
        addNotice({ type: "error", message: "Tool filtering is not supported in OMP RPC mode." });
      }
      return;
    }
    try {
      await sendAgentCommand(sid, { type: "set_tools", toolNames });
    } catch (e) {
      // The backend could not enforce the preset (unsupported in OMP RPC
      // mode) — revert so the UI never shows a guardrail that is not active.
      setPreferredToolPreset(previousPreset);
      setToolPresetState(previousPreset);
      console.error("Failed to set tools:", e);
    }
  }, [addNotice, setToolPresetState, toolPreset]);

  const handleQueueModeChange = useCallback(async (patch: Partial<QueueModes>) => {
    const previous = queueModes;
    const next = { ...queueModes, ...patch };
    setQueueModes(next);
    setPreferredQueueModes(next);
    const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
    if (!sid) return; // New session: applied at creation via ensureNewSession
    try {
      if (patch.steeringMode) {
        await sendAgentCommand(sid, { type: "set_steering_mode", mode: patch.steeringMode });
      }
      if (patch.followUpMode) {
        await sendAgentCommand(sid, { type: "set_follow_up_mode", mode: patch.followUpMode });
      }
      if (patch.interruptMode) {
        await sendAgentCommand(sid, { type: "set_interrupt_mode", mode: patch.interruptMode });
      }
    } catch (e) {
      // Revert the optimistic toggle so the UI reflects the actual session state.
      setQueueModes(previous);
      setPreferredQueueModes(previous);
      addNotice({
        type: "error",
        message: `Failed to set queue mode: ${e instanceof Error ? e.message : String(e)}`,
      });
      console.error("Failed to set queue mode:", e);
    }
  }, [queueModes, addNotice]);
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
