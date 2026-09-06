"use client";

import { useCallback } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { AgentMessage, ExtensionUiRequest } from "@/lib/types";
import { normalizeToolCalls } from "@/lib/normalize";
import { normalizeSubagentEvent, type SubagentInfo } from "@/lib/subagents";
import { normalizeGoalEvent, type GoalModeInfo } from "@/lib/goal";
import type { TodoPhase } from "@/lib/todos";
import { userMessageKey } from "@/lib/prompt-recovery";
import { extractToolCommand, getToolExecutionProgress, toolArgsDigest } from "@/lib/tool-execution-progress";
import { readCompactResult, type CompactResultInfo } from "@/lib/compaction-summary";
import type { ClientAssistantMessageEvent, StreamAction } from "@/lib/streaming-message";
import type {
  AgentEvent,
  AgentPhase,
  AgentStateResponse,
  ContextUsageInfo,
  QueuedMessages,
} from "./types";
import { normalizeQueuedMessages } from "./types";
import type { NoticeType } from "./notices";
import type { useEventStream } from "./event-stream";
import type { useSessionLoader } from "./session-loader";

type EventStreamApi = ReturnType<typeof useEventStream>;
type SessionLoaderApi = ReturnType<typeof useSessionLoader>;

export interface EventDispatcherDeps {
  // Facade-owned refs.
  sessionIdRef: RefObject<string | null>;
  promptRunIdRef: RefObject<number>;
  optimisticUserMessageKeyRef: RefObject<string | null>;
  ttsrAbortPendingRef: RefObject<boolean>;
  messagesTailCompleteRef: RefObject<boolean>;
  toolCommandByIdRef: RefObject<Map<string, string>>;
  // Module APIs.
  stream: EventStreamApi;
  loader: SessionLoaderApi;
  addNotice: (notice: { id?: string; message: string; type?: NoticeType }) => void;
  handleExtensionUiRequest: (request: ExtensionUiRequest) => void;
  // Scroll wiring.
  isNearBottomRef: RefObject<boolean>;
  pendingScrollToUserRef: RefObject<boolean>;
  liveFollowFrameRef: RefObject<number | null>;
  scrollToBottom: (behavior?: "auto" | "smooth") => void;
  // Coalescers + streaming reducer.
  commitAgentPhase: (next: AgentPhase) => void;
  flushPendingPhase: () => void;
  queuePhaseUpdate: (updater: (prev: AgentPhase) => AgentPhase) => void;
  pushDelta: (delta: ClientAssistantMessageEvent) => void;
  flushPendingDeltas: () => void;
  dispatch: Dispatch<StreamAction>;
  // Subagent roster.
  queueSubagentEvent: (info: SubagentInfo) => void;
  refreshSubagents: (sid: string) => Promise<void>;
  // Facade state.
  setQueuedMessages: Dispatch<SetStateAction<QueuedMessages>>;
  setContextUsage: Dispatch<SetStateAction<ContextUsageInfo | null>>;
  setSystemPrompt: Dispatch<SetStateAction<string | null>>;
  setSubagentsUnavailable: Dispatch<SetStateAction<boolean>>;
  setTodoPhases: Dispatch<SetStateAction<TodoPhase[]>>;
  setGoal: Dispatch<SetStateAction<GoalModeInfo | null>>;
  setCompactError: Dispatch<SetStateAction<string | null>>;
  setCompactResult: Dispatch<SetStateAction<CompactResultInfo | null>>;
  refreshTodos: (sid: string) => Promise<void>;
  onAgentEnd?: () => void;
}

/**
 * The SSE event reducer: routes every agent event type to its UI state
 * transition (streaming lifecycle, tool activity phases, queue updates,
 * compaction, extension UI, subagents, todos and goal mode).
 */
export function useEventDispatcher(deps: EventDispatcherDeps) {
  const {
    sessionIdRef,
    promptRunIdRef,
    optimisticUserMessageKeyRef,
    ttsrAbortPendingRef,
    messagesTailCompleteRef,
    toolCommandByIdRef,
    stream,
    loader,
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
  } = deps;

  const {
    agentRunningRef,
    sdkAgentActiveRef,
    rpcPromptPendingRef,
    setAgentRunning,
    setRetryInfo,
    setIsCompacting,
    cancelEventStreamGrace,
    scheduleEventStreamClose,
    settleUiStage,
    notifyPromptStage,
  } = stream;
  const { setMessages, loadSession, reloadSessionPreservingTail } = loader;

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
  }, [addNotice, agentRunningRef, cancelEventStreamGrace, commitAgentPhase, dispatch, flushPendingDeltas, flushPendingPhase, handleExtensionUiRequest, isNearBottomRef, liveFollowFrameRef, loadSession, messagesTailCompleteRef, notifyPromptStage, onAgentEnd, optimisticUserMessageKeyRef, pendingScrollToUserRef, promptRunIdRef, pushDelta, queuePhaseUpdate, queueSubagentEvent, refreshSubagents, refreshTodos, reloadSessionPreservingTail, rpcPromptPendingRef, scheduleEventStreamClose, scrollToBottom, sdkAgentActiveRef, sessionIdRef, setAgentRunning, setCompactError, setCompactResult, setContextUsage, setIsCompacting, setMessages, setQueuedMessages, setRetryInfo, setSubagentsUnavailable, setSystemPrompt, settleUiStage, setTodoPhases, setGoal, toolCommandByIdRef, ttsrAbortPendingRef]);

  return { handleAgentEvent };
}
