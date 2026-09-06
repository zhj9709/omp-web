"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { AgentEventConnection } from "@/lib/agent-event-connection";
import type { StreamAction } from "@/lib/streaming-message";
import {
  normalizeQueuedMessages,
  type AgentEvent,
  type AgentPhase,
  type AgentStateResponse,
  type ContextUsageInfo,
  type QueuedMessages,
} from "./types";

const PROMPT_SETTLE_INITIAL_DELAY_MS = 800;
const PROMPT_SETTLE_POLL_MS = 600;
const PROMPT_SETTLE_MAX_MS = 20_000;
const EVENT_STREAM_IDLE_GRACE_MS = 30_000;
const AGENT_STATE_RECONCILE_MS = 15_000;
export const BASH_STATE_RECONCILE_MS = 1_000;
const EVENT_STREAM_READY_TIMEOUT_MS = 60_000;
const EVENT_STREAM_RECONNECT_DELAY_MS = 1_000;

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface EventStreamDeps {
  // Refs owned by the composition root.
  sessionIdRef: RefObject<string | null>;
  sessionPropIdRef: RefObject<string | null>;
  sessionRunningRef: RefObject<boolean>;
  promptRunIdRef: RefObject<number>;
  optimisticUserMessageKeyRef: RefObject<string | null>;
  // Props mirrored into the sessionRunning attach effect.
  sessionId?: string | null;
  sessionRunning?: boolean;
  // Loader callback.
  loadSession: (sid: string, showLoading?: boolean, includeState?: boolean, runId?: number) => Promise<{ running: boolean; state?: AgentStateResponse } | null>;
  onAgentEnd?: () => void;
  // Streaming/phase coalescers owned by the composition root.
  commitAgentPhase: (next: AgentPhase) => void;
  flushPendingPhase: () => void;
  flushPendingDeltas: () => void;
  dispatch: Dispatch<StreamAction>;
  // State owned by the composition root, mirrored from reconciled snapshots.
  setSubagentsUnavailable: Dispatch<SetStateAction<boolean>>;
  setQueuedMessages: Dispatch<SetStateAction<QueuedMessages>>;
  setContextUsage: Dispatch<SetStateAction<ContextUsageInfo | null>>;
  setSystemPrompt: Dispatch<SetStateAction<string | null>>;
}

/**
 * The agent event stream and the run state machine: SSE connection
 * management (including the idle grace window), the run-scoped refs
 * (agentRunning / sdkAgentActive / rpcPromptPending / promptRunId), the
 * UI settlement path (settleUiStage / finishPromptWithoutStream /
 * waitForPromptSettlement) and the state reconciliation recovery net.
 */
export function useEventStream(deps: EventStreamDeps) {
  const {
    sessionIdRef,
    sessionPropIdRef,
    sessionRunningRef,
    promptRunIdRef,
    optimisticUserMessageKeyRef,
    sessionId,
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
  } = deps;

  const [agentRunning, setAgentRunning] = useState(false);
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; maxAttempts: number; errorMessage?: string } | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const eventConnectionRef = useRef<AgentEventConnection | null>(null);
  const eventStreamGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventStreamGraceGenerationRef = useRef(0);
  const eventStreamGraceActiveRef = useRef(false);
  const agentRunningRef = useRef(false);
  const sdkAgentActiveRef = useRef(false);
  const rpcPromptPendingRef = useRef(false);
  const notifiedPromptRunIdRef = useRef(-1);
  const handleAgentEventRef = useRef<((event: AgentEvent) => void) | null>(null);
  const sessionHookMountedRef = useRef(true);

  if (!eventConnectionRef.current) {
    eventConnectionRef.current = new AgentEventConnection({
      createSource: (sid) => new EventSource(`/api/agent/${encodeURIComponent(sid)}/events`),
      onEvent: (event) => handleAgentEventRef.current?.(event as AgentEvent),
      shouldMaintain: (sid) => (
        sessionHookMountedRef.current
        && sessionIdRef.current === sid
        && (
          agentRunningRef.current
          || eventStreamGraceActiveRef.current
          || (sessionPropIdRef.current === sid && sessionRunningRef.current)
        )
      ),
      readinessTimeoutMs: EVENT_STREAM_READY_TIMEOUT_MS,
      reconnectDelayMs: EVENT_STREAM_RECONNECT_DELAY_MS,
      onUnexpectedError: (error) => {
        console.error("Failed to maintain the agent event stream:", error);
      },
    });
  }

  const cancelEventStreamGrace = useCallback(() => {
    eventStreamGraceGenerationRef.current += 1;
    eventStreamGraceActiveRef.current = false;
    if (eventStreamGraceTimerRef.current) {
      clearTimeout(eventStreamGraceTimerRef.current);
      eventStreamGraceTimerRef.current = null;
    }
  }, []);

  const closeEvents = useCallback(() => {
    eventConnectionRef.current?.close();
  }, []);

  const ensureEventsConnected = useCallback((sid: string) => (
    eventConnectionRef.current!.ensureConnected(sid)
  ), []);

  const maintainEventsConnected = useCallback((sid: string) => {
    eventConnectionRef.current!.maintain(sid);
  }, []);

  // A different browser can start this session after it was opened here.
  // The sidebar's lightweight running-state poll gives us a cheap signal to
  // attach to the existing SSE stream without adding another synchronization
  // protocol to the chat. The cleanup intentionally reads the latest identity
  // refs; they arrive as props, so the lint rule cannot see they are stable.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!sessionId || !sessionRunning) return;
    maintainEventsConnected(sessionId);
    return () => {
      if (
        sessionIdRef.current === sessionId
        && !agentRunningRef.current
        && !eventStreamGraceActiveRef.current
        && (sessionPropIdRef.current !== sessionId || !sessionRunningRef.current)
      ) {
        eventConnectionRef.current?.close();
      }
    };
  }, [maintainEventsConnected, sessionId, sessionRunning]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const settleUiStage = useCallback(() => {
    const wasRunning = agentRunningRef.current;
    agentRunningRef.current = false;
    setAgentRunning(false);
    flushPendingPhase();
    commitAgentPhase(null);
    setRetryInfo(null);
    flushPendingDeltas();
    dispatch({ type: "end" });
    return wasRunning;
  }, [commitAgentPhase, dispatch, flushPendingDeltas, flushPendingPhase]);

  const notifyPromptStage = useCallback((runId: number) => {
    if (notifiedPromptRunIdRef.current === runId) return false;
    notifiedPromptRunIdRef.current = runId;
    onAgentEnd?.();
    return true;
  }, [onAgentEnd]);

  const scheduleEventStreamClose = useCallback((sid: string) => {
    cancelEventStreamGrace();
    eventStreamGraceActiveRef.current = true;
    const generation = eventStreamGraceGenerationRef.current;

    const checkServerIdle = async () => {
      if (
        generation !== eventStreamGraceGenerationRef.current
        || sessionIdRef.current !== sid
        || !eventStreamGraceActiveRef.current
      ) return;

      try {
        const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { running?: boolean; state?: AgentStateResponse };
        if (
          generation !== eventStreamGraceGenerationRef.current
          || sessionIdRef.current !== sid
          || !eventStreamGraceActiveRef.current
        ) return;

        const state = data.state;
        const promptActive = Boolean(data.running && state && (state.isStreaming || state.isPromptRunning));
        if (promptActive) {
          eventStreamGraceActiveRef.current = false;
          eventStreamGraceTimerRef.current = null;
          sdkAgentActiveRef.current = Boolean(state?.isStreaming);
          rpcPromptPendingRef.current = Boolean(state?.isPromptRunning);
          agentRunningRef.current = true;
          setAgentRunning(true);
          commitAgentPhase(state?.isStreaming ? { kind: "waiting_model" } : { kind: "running_command" });
          return;
        }

        if (data.running && state?.isCompacting) {
          setIsCompacting(true);
          eventStreamGraceTimerRef.current = setTimeout(() => void checkServerIdle(), PROMPT_SETTLE_POLL_MS);
          return;
        }

        eventStreamGraceActiveRef.current = false;
        eventStreamGraceTimerRef.current = null;
        closeEvents();
      } catch {
        // Keep the stream alive while state cannot be verified.
        if (
          generation !== eventStreamGraceGenerationRef.current
          || sessionIdRef.current !== sid
          || !eventStreamGraceActiveRef.current
        ) return;
        eventStreamGraceTimerRef.current = setTimeout(() => void checkServerIdle(), PROMPT_SETTLE_POLL_MS);
      }
    };

    eventStreamGraceTimerRef.current = setTimeout(() => void checkServerIdle(), EVENT_STREAM_IDLE_GRACE_MS);
  }, [cancelEventStreamGrace, closeEvents, commitAgentPhase, sessionIdRef]);

  const finishPromptWithoutStream = useCallback(async (sid: string | null = sessionIdRef.current, runId = promptRunIdRef.current) => {
    // Bail out before loadSession too: a stale finish for a previous run
    // must not overwrite the messages of the run currently streaming.
    if (promptRunIdRef.current !== runId) return;
    try {
      if (sid) await loadSession(sid, false, false, runId);
    } finally {
      if (promptRunIdRef.current !== runId) return;
      const promptWasPending = rpcPromptPendingRef.current;
      const agentWasActive = sdkAgentActiveRef.current;
      rpcPromptPendingRef.current = false;
      sdkAgentActiveRef.current = false;
      optimisticUserMessageKeyRef.current = null;
      const wasRunning = settleUiStage();
      if (promptWasPending) {
        notifyPromptStage(runId);
      } else if (agentWasActive && wasRunning) {
        onAgentEnd?.();
      }
      if (sid) scheduleEventStreamClose(sid);
    }
  }, [loadSession, notifyPromptStage, onAgentEnd, optimisticUserMessageKeyRef, promptRunIdRef, scheduleEventStreamClose, sessionIdRef, settleUiStage]);

  const waitForPromptSettlement = useCallback(async (sid: string, runId?: number) => {
    await delay(PROMPT_SETTLE_INITIAL_DELAY_MS);
    const startedAt = Date.now();

    while (agentRunningRef.current && Date.now() - startedAt < PROMPT_SETTLE_MAX_MS) {
      if (runId !== undefined && promptRunIdRef.current !== runId) return;
      try {
        const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
        if (res.ok) {
          const data = await res.json() as { running?: boolean; state?: AgentStateResponse };
          const state = data.state;
          if (!data.running || !state || (!state.isStreaming && !state.isPromptRunning)) {
            await finishPromptWithoutStream(sid, runId);
            return;
          }
        }
      } catch {
        // SSE remains the primary completion path.
      }
      await delay(PROMPT_SETTLE_POLL_MS);
    }
  }, [agentRunningRef, finishPromptWithoutStream, promptRunIdRef]);

  // Reconcile client streaming state with the server. When SSE events are
  // missed (network drop, mobile tab backgrounded, half-open connection),
  // agent_end never arrives and the UI stays in streaming state forever.
  // If the server reports idle while we still think it's running, finish
  // through the same settlement path used by non-streaming prompts.
  const reconcileAgentState = useCallback(async (sid: string) => {
    if (!agentRunningRef.current || sessionIdRef.current !== sid) return;
    const runId = promptRunIdRef.current;
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
      if (!res.ok) return;
      const data = await res.json() as { running?: boolean; state?: AgentStateResponse };
      // A slow response can straddle a run boundary (previous run finished
      // and the user already started the next one while this request was in
      // flight) — everything in it is stale, drop it.
      if (sessionIdRef.current !== sid || promptRunIdRef.current !== runId) return;
      const state = data.state;
      // Mirror compaction state unconditionally: a missed compaction_end
      // would otherwise leave the "Stop compaction" UI stuck. No state
      // (wrapper destroyed) means nothing is compacting.
      setIsCompacting(state?.isCompacting ?? false);
      setQueuedMessages(normalizeQueuedMessages(state?.queuedMessages));
      const busy = data.running && state
        && (state.isStreaming || state.isPromptRunning || state.isCompacting);
      if (busy) {
        sdkAgentActiveRef.current = Boolean(state.isStreaming);
        rpcPromptPendingRef.current = Boolean(state.isPromptRunning);
        return;
      }
      if (!agentRunningRef.current) return;
      if (state) {
        if (state.contextUsage !== undefined) setContextUsage(state.contextUsage ?? null);
        if (state.systemPrompt !== undefined) setSystemPrompt(state.systemPrompt ?? null);
        // extensionStatuses/extensionWidgets omitted: snapshots always report
        // empty arrays; SSE events are the only source of extension UI state.
        if (state.subagentSubscription !== undefined) {
          setSubagentsUnavailable(!state.subagentSubscription.available);
        }
      }
      await finishPromptWithoutStream(sid, runId);
    } catch {
      // Network still down — the next poll / visibility / online tick retries.
    }
  }, [agentRunningRef, finishPromptWithoutStream, promptRunIdRef, sessionIdRef, setContextUsage, setQueuedMessages, setSubagentsUnavailable, setSystemPrompt]);

  // Recovery net for missed SSE events: while the agent is running, verify
  // against the server periodically and whenever the tab returns to the
  // foreground or the network comes back.
  useEffect(() => {
    if (!agentRunning) return;
    const reconcile = () => {
      // Read the ref on every tick: for brand-new sessions the id is
      // assigned only after ensure_session returns.
      const sid = sessionIdRef.current;
      if (sid) void reconcileAgentState(sid);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    const interval = setInterval(reconcile, AGENT_STATE_RECONCILE_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", reconcile);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", reconcile);
    };
  }, [agentRunning, reconcileAgentState, sessionIdRef]);

  useEffect(() => {
    agentRunningRef.current = agentRunning;
  }, [agentRunning]);

  return {
    agentRunning,
    setAgentRunning,
    agentRunningRef,
    sdkAgentActiveRef,
    rpcPromptPendingRef,
    retryInfo,
    setRetryInfo,
    isCompacting,
    setIsCompacting,
    handleAgentEventRef,
    sessionHookMountedRef,
    cancelEventStreamGrace,
    closeEvents,
    ensureEventsConnected,
    maintainEventsConnected,
    settleUiStage,
    notifyPromptStage,
    scheduleEventStreamClose,
    finishPromptWithoutStream,
    waitForPromptSettlement,
    reconcileAgentState,
  };
}
