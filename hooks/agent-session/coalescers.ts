"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import {
  mergeSubagentSnapshot,
  upsertSubagent,
  SUBAGENT_TERMINAL_STATUSES,
  type SubagentInfo,
  type SubagentTranscript,
} from "@/lib/subagents";
import type { ClientAssistantMessageEvent, StreamAction } from "@/lib/streaming-message";
import type { AgentPhase } from "./types";

// message_update deltas are rAF-coalesced into a single dispatch per frame to
// avoid a React render per token. Flush synchronously before any non-delta
// stream-state mutation so stale deltas can't resurrect a finished bubble.
export function useDeltaCoalescer(dispatch: Dispatch<StreamAction>) {
  const pendingDeltasRef = useRef<ClientAssistantMessageEvent[]>([]);
  const deltaFrameRef = useRef<number | null>(null);

  const flushPendingDeltas = useCallback(() => {
    if (deltaFrameRef.current !== null) {
      cancelAnimationFrame(deltaFrameRef.current);
      deltaFrameRef.current = null;
    }
    const deltas = pendingDeltasRef.current;
    if (deltas.length > 0) {
      pendingDeltasRef.current = [];
      dispatch({ type: "deltaBatch", events: deltas });
    }
  }, [dispatch]);

  const pushDelta = useCallback((delta: ClientAssistantMessageEvent) => {
    pendingDeltasRef.current.push(delta);
    if (deltaFrameRef.current === null) {
      deltaFrameRef.current = requestAnimationFrame(() => {
        deltaFrameRef.current = null;
        const deltas = pendingDeltasRef.current;
        pendingDeltasRef.current = [];
        if (deltas.length > 0) {
          dispatch({ type: "deltaBatch", events: deltas });
        }
      });
    }
  }, [dispatch]);

  // Cancel the coalescing frame on unmount: a frame scheduled after unmount
  // would dispatch into a dead component tree.
  useEffect(() => () => {
    if (deltaFrameRef.current !== null) {
      cancelAnimationFrame(deltaFrameRef.current);
      deltaFrameRef.current = null;
    }
    pendingDeltasRef.current = [];
  }, []);

  return { flushPendingDeltas, pushDelta };
}

// --- rAF-coalesced agent phase updates --------------------------------------
// High-frequency phase events (tool_execution_update progress ticks) funnel
// through queuePhaseUpdate and settle in one setState per frame. Low-frequency
// state transitions use commitAgentPhase (immediate) after flushPendingPhase
// where ordering matters (terminal states).
export function useAgentPhase() {
  const [agentPhase, setAgentPhase] = useState<AgentPhase>(null);
  const agentPhaseRef = useRef<AgentPhase>(null);
  const pendingPhaseRef = useRef<{ value: AgentPhase } | null>(null);
  const phaseFrameRef = useRef<number | null>(null);

  const schedulePhaseFlush = useCallback(() => {
    if (phaseFrameRef.current !== null) return;
    phaseFrameRef.current = requestAnimationFrame(() => {
      phaseFrameRef.current = null;
      const pending = pendingPhaseRef.current;
      pendingPhaseRef.current = null;
      if (pending) {
        agentPhaseRef.current = pending.value;
        setAgentPhase(pending.value);
      }
    });
  }, []);

  const queuePhaseUpdate = useCallback((updater: (prev: AgentPhase) => AgentPhase) => {
    const prev = pendingPhaseRef.current?.value ?? agentPhaseRef.current ?? null;
    pendingPhaseRef.current = { value: updater(prev) };
    schedulePhaseFlush();
  }, [schedulePhaseFlush]);

  const flushPendingPhase = useCallback(() => {
    if (phaseFrameRef.current !== null) {
      cancelAnimationFrame(phaseFrameRef.current);
      phaseFrameRef.current = null;
    }
    const pending = pendingPhaseRef.current;
    pendingPhaseRef.current = null;
    if (pending) {
      agentPhaseRef.current = pending.value;
      setAgentPhase(pending.value);
    }
  }, []);

  const commitAgentPhase = useCallback((next: AgentPhase) => {
    agentPhaseRef.current = next;
    setAgentPhase(next);
  }, []);

  useEffect(() => () => {
    if (phaseFrameRef.current !== null) {
      cancelAnimationFrame(phaseFrameRef.current);
      phaseFrameRef.current = null;
    }
  }, []);

  return { agentPhase, agentPhaseRef, queuePhaseUpdate, flushPendingPhase, commitAgentPhase };
}

// --- rAF-coalesced subagent roster updates --------------------------------
// OMP snapshots carry only `lastUpdate`; track the first observed running
// time and the terminal time here so the roster can show real elapsed
// durations (mirroring the DSH subagent monitor).
export function useSubagents(sessionIdRef: RefObject<string | null>) {
  const [subagents, setSubagents] = useState<SubagentInfo[]>([]);
  const [subagentsUnavailable, setSubagentsUnavailable] = useState(false);
  const pendingSubagentEventsRef = useRef<SubagentInfo[]>([]);
  const subagentFrameRef = useRef<number | null>(null);
  const subagentStartedAtRef = useRef<Map<string, number>>(new Map());
  const subagentEndedAtRef = useRef<Map<string, number>>(new Map());
  // OMP lifecycle frames use "started" for a running subagent; completed/
  // failed/aborted are terminal. Anything else (running/working/in_progress/
  // active) is also live.
  const trackSubagentTimings = useCallback((roster: SubagentInfo[]): SubagentInfo[] => {
    const started = subagentStartedAtRef.current;
    const ended = subagentEndedAtRef.current;
    return roster.map((info) => {
      if (!SUBAGENT_TERMINAL_STATUSES[info.status]) {
        if (!started.has(info.id)) started.set(info.id, Date.now());
        return { ...info, startedAt: started.get(info.id) };
      }
      if (!ended.has(info.id)) ended.set(info.id, Date.now());
      return { ...info, startedAt: started.get(info.id), endedAt: ended.get(info.id) };
    });
  }, []);

  const queueSubagentEvent = useCallback((info: SubagentInfo) => {
    pendingSubagentEventsRef.current.push(info);
    if (subagentFrameRef.current !== null) return;
    subagentFrameRef.current = requestAnimationFrame(() => {
      subagentFrameRef.current = null;
      const events = pendingSubagentEventsRef.current;
      pendingSubagentEventsRef.current = [];
      if (events.length === 0) return;
      setSubagents((prev) => {
        let next = prev;
        for (const ev of events) next = upsertSubagent(next, ev);
        return trackSubagentTimings(next);
      });
    });
  }, [trackSubagentTimings]);

  const refreshSubagents = useCallback(async (sid: string) => {
    try {
      const snapshot = await sendAgentCommand<{ subagents?: unknown }>(sid, {
        type: "get_subagents",
      });
      if (sessionIdRef.current !== sid) return;
      setSubagents((prev) => trackSubagentTimings(mergeSubagentSnapshot(prev, snapshot)));
    } catch {
      // Best-effort refresh; lifecycle events keep the roster current anyway.
    }
  }, [sessionIdRef, trackSubagentTimings]);

  const loadSubagentTranscript = useCallback(
    async (subagentId: string): Promise<SubagentTranscript | null> => {
      const sid = sessionIdRef.current;
      if (!sid) return null;
      try {
        return await sendAgentCommand<SubagentTranscript>(sid, {
          type: "get_subagent_messages",
          subagentId,
        });
      } catch {
        return null;
      }
    },
    [sessionIdRef],
  );

  useEffect(() => () => {
    if (subagentFrameRef.current !== null) {
      cancelAnimationFrame(subagentFrameRef.current);
      subagentFrameRef.current = null;
    }
    pendingSubagentEventsRef.current = [];
  }, []);

  return {
    subagents,
    subagentsUnavailable,
    setSubagentsUnavailable,
    queueSubagentEvent,
    refreshSubagents,
    loadSubagentTranscript,
  };
}
