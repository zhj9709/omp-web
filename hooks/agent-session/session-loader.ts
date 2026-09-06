"use client";

import { useCallback, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { AgentMessage } from "@/lib/types";
import { sendAgentCommand } from "@/lib/agent-client";
import type { ToolEntry, ToolPreset } from "@/lib/tool-presets";
import { normalizeTodoPhases, type TodoPhase } from "@/lib/todos";
import type { QueueModes } from "@/lib/queue-mode-preference";
import {
  normalizeQueuedMessages,
  type AgentStateResponse,
  type ContextUsageInfo,
  type QueuedMessages,
  type SessionData,
  type ThinkingLevelOption,
} from "./types";

export interface SessionLoaderDeps {
  /** Initial loading value: false for fresh new-session drafts, true otherwise. */
  initialLoading: boolean;
  // Session identity ref owned by the composition root.
  sessionIdRef: RefObject<string | null>;
  // Run-machine refs shared with the event-stream module.
  promptRunIdRef: RefObject<number>;
  messagesTailCompleteRef: RefObject<boolean>;
  // Model state owned by the composition root.
  modelSwitchPendingRef: RefObject<boolean>;
  setCurrentModelOverride: Dispatch<SetStateAction<{ provider: string; modelId: string } | null>>;
  setToolPresetState: (preset: ToolPreset) => void;
  // Session-scope state owned by the composition root, applied from loaded
  // session data and live agent state snapshots.
  setThinkingLevel: Dispatch<SetStateAction<ThinkingLevelOption>>;
  setContextUsage: Dispatch<SetStateAction<ContextUsageInfo | null>>;
  setSystemPrompt: Dispatch<SetStateAction<string | null>>;
  setQueuedMessages: Dispatch<SetStateAction<QueuedMessages>>;
  setFastModeEnabled: Dispatch<SetStateAction<boolean>>;
  setFastModeActive: Dispatch<SetStateAction<boolean>>;
  setQueueModes: Dispatch<SetStateAction<QueueModes>>;
  setTodoPhases: Dispatch<SetStateAction<TodoPhase[]>>;
  setSubagentsUnavailable: Dispatch<SetStateAction<boolean>>;
  expandCompaction: boolean | undefined;
}

/**
 * Session transcript loading: the displayed session file state (data/
 * messages/entryIds/leaf) plus the JSONL fetch paths (loadSession,
 * loadContext) and the RPC tool listing. Owns the expandCompaction mirror
 * ref and the branch-navigation request id.
 */
export function useSessionLoader(deps: SessionLoaderDeps) {
  const {
    initialLoading,
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
  } = deps;

  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(initialLoading);
  const [error, setError] = useState<string | null>(null);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  // Mirror of expandCompaction so loadSession / loadContext (which are wrapped
  // in stable useCallbacks with many callers) always read the latest value
  // without forcing a full deps rewrite.
  const expandCompactionRef = useRef(expandCompaction);
  expandCompactionRef.current = expandCompaction;
  // Monotonic request id for branch/leaf context loads: rapid navigations
  // must never let an older response overwrite the newer one.
  const loadContextRequestIdRef = useRef(0);

  const loadSession = useCallback(async (sid: string, showLoading = false, includeState = false, runId?: number) => {
    let messagesLoaded = false;
    try {
      if (showLoading) setLoading(true);
      const params = new URLSearchParams({ deferThinking: "1", deferMedia: "1" });
      if (expandCompactionRef.current) params.set("expandCompaction", "1");
      const res = await fetch(`/api/sessions/${encodeURIComponent(sid)}?${params}`);
      if (res.status === 404) {
        if (showLoading) {
          setData(null);
          setActiveLeafId(null);
          setMessages([]);
          setError(null);
        }
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as SessionData;
      if (sessionIdRef.current !== sid) return null;
      // A run-scoped reload (post-settle refresh) must not clobber the state
      // of a newer run that started while the fetch was in flight — most
      // visibly the optimistic user message of the next prompt.
      if (runId !== undefined && promptRunIdRef.current !== runId) return null;
      const persistedMessages = d.context.messages;
      setData(d);
      setActiveLeafId(d.leafId);
      setMessages(persistedMessages);
      setEntryIds(d.context.entryIds ?? []);
      setCurrentModelOverride((current) => modelSwitchPendingRef.current ? current : null);
      setError(null);
      if (d.contextUsage !== undefined) setContextUsage(d.contextUsage ?? null);
      if (d.context.thinkingLevel && d.context.thinkingLevel !== "off") {
        setThinkingLevel(d.context.thinkingLevel as ThinkingLevelOption);
      }

      messagesLoaded = true;
      if (showLoading) setLoading(false);
      if (!includeState) return null;

      try {
        const stateRes = await fetch(`/api/sessions/${encodeURIComponent(sid)}/state`);
        if (!stateRes.ok) throw new Error(`HTTP ${stateRes.status}`);
        const agentState = await stateRes.json() as { running: boolean; state?: AgentStateResponse };
        if (sessionIdRef.current !== sid) return null;

        const liveState = agentState.state;
        if (liveState) {
          if (liveState.contextUsage !== undefined) setContextUsage(liveState.contextUsage ?? null);
          if (liveState.systemPrompt !== undefined) setSystemPrompt(liveState.systemPrompt ?? null);
          if (liveState.thinkingLevel !== undefined) setThinkingLevel((liveState.thinkingLevel as ThinkingLevelOption) ?? "auto");
          // Note: extensionStatuses/extensionWidgets are deliberately NOT
          // applied from state snapshots — OMP's mapGetState always reports
          // them as empty arrays, so applying them would wipe the SSE-driven
          // extension UI state at every turn end. SSE events are the sole source.
          if (liveState.queuedMessages !== undefined) setQueuedMessages(normalizeQueuedMessages(liveState.queuedMessages));
          if (liveState.fastModeEnabled !== undefined) setFastModeEnabled(liveState.fastModeEnabled);
          if (liveState.fastModeActive !== undefined) setFastModeActive(liveState.fastModeActive);
          if (
            liveState.steeringMode !== undefined
            || liveState.followUpMode !== undefined
            || liveState.interruptMode !== undefined
          ) {
            setQueueModes((prev) => ({
              steeringMode: (liveState.steeringMode as QueueModes["steeringMode"]) ?? prev.steeringMode,
              followUpMode: (liveState.followUpMode as QueueModes["followUpMode"]) ?? prev.followUpMode,
              interruptMode: (liveState.interruptMode as QueueModes["interruptMode"]) ?? prev.interruptMode,
            }));
          }
          if (liveState.todoPhases !== undefined) setTodoPhases(normalizeTodoPhases(liveState.todoPhases));
          if (liveState.subagentSubscription !== undefined) {
            setSubagentsUnavailable(!liveState.subagentSubscription.available);
          }
        } else if (!agentState.running) {
          setQueuedMessages({ steering: [], followUp: [] });
        }
        return agentState;
      } catch (e) {
        console.error("Failed to load agent state:", e);
        return null;
      }
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      if (showLoading && !messagesLoaded) setLoading(false);
    }
  }, [modelSwitchPendingRef, promptRunIdRef, sessionIdRef, setCurrentModelOverride, setContextUsage, setEntryIds, setError, setFastModeActive, setFastModeEnabled, setLoading, setMessages, setQueuedMessages, setQueueModes, setActiveLeafId, setData, setSubagentsUnavailable, setSystemPrompt, setThinkingLevel, setTodoPhases]);

  // Full-session reloads re-render every message (defer-thinking variants,
  // full Markdown), which reads as a flash when the finished message is
  // already on screen. Reload only when the tail is missing this run's
  // complete assistant message (missed SSE, TTSR retry, compaction).
  const reloadSessionPreservingTail = useCallback((sid: string) => {
    if (messagesTailCompleteRef.current) {
      messagesTailCompleteRef.current = false;
      return;
    }
    loadSession(sid, false, false, promptRunIdRef.current);
  }, [loadSession, messagesTailCompleteRef, promptRunIdRef]);

  const loadContext = useCallback(async (sid: string, leafId: string | null) => {
    const requestId = ++loadContextRequestIdRef.current;
    try {
      const params = new URLSearchParams({ deferThinking: "1", deferMedia: "1" });
      if (leafId) params.set("leafId", leafId);
      if (expandCompactionRef.current) params.set("expandCompaction", "1");
      const url = `/api/sessions/${encodeURIComponent(sid)}/context?${params}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { context: { messages: AgentMessage[]; entryIds: string[] } };
      // Drop responses from superseded navigations: rapid A→B branch switches
      // must not let A's late response overwrite B's messages.
      if (requestId !== loadContextRequestIdRef.current) return;
      if (sessionIdRef.current !== sid) return;
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
    } catch (e) {
      console.error("Failed to load context:", e);
    }
  }, [sessionIdRef, setEntryIds, setMessages]);

  const loadTools = useCallback(async (sid: string) => {
    try {
      const tools = await sendAgentCommand<ToolEntry[]>(sid, { type: "get_tools" });
      if (tools) {
        const { getPresetFromTools } = await import("@/lib/tool-presets");
        setToolPresetState(getPresetFromTools(tools));
      }
    } catch (e) {
      console.error("Failed to load tools:", e);
    }
  }, [setToolPresetState]);

  return {
    data, setData,
    loading,
    error,
    activeLeafId, setActiveLeafId,
    messages, setMessages,
    entryIds, setEntryIds,
    loadSession,
    reloadSessionPreservingTail,
    loadContext,
    loadTools,
  };
}
