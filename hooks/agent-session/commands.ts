"use client";

import { useCallback, useLayoutEffect, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { AgentMessage, SessionInfo } from "@/lib/types";
import {
  AgentCommandError,
  isPromptRejectedError,
  sendAgentCommand,
} from "@/lib/agent-client";
import { restoreDraftSubmission } from "@/lib/draft-store";
import { getPreferredToolPreset, setPreferredToolPreset } from "@/lib/tool-preset-preference";
import {
  getPreferredQueueModes,
  setPreferredQueueModes,
  type QueueModes,
} from "@/lib/queue-mode-preference";
import {
  getToolNamesForPreset,
  isRestrictiveToolRequest,
  type ToolPreset,
} from "@/lib/tool-presets";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { OMP_EXECUTABLE_SLASH_COMMANDS, TUI_ONLY_SLASH_COMMANDS } from "@/lib/slash-command-catalog";
import { userMessageKey } from "@/lib/prompt-recovery";
import { readCompactResult, type CompactCommandResult, type CompactResultInfo } from "@/lib/compaction-summary";
import { mergeTuiOnlyCommands } from "@/lib/slash-command-catalog";
import type {
  AgentStateResponse,
  AttachedImage,
  BuiltinSlashCommandResult,
  LastAssistantTextResponse,
  QueuedMessages,
  SlashCommandInfo,
  SlashCommandsResponse,
  ThinkingLevelOption,
} from "./types";
import type { ChatInputHandle } from "./types";
import type { NoticeType } from "./notices";
import type { useEventStream } from "./event-stream";
import type { useSessionLoader } from "./session-loader";
import type { useSessionModels } from "./models";
import type { useNewSessionFlow } from "./new-session";

type EventStreamApi = ReturnType<typeof useEventStream>;
type SessionLoaderApi = ReturnType<typeof useSessionLoader>;
type SessionModelsApi = ReturnType<typeof useSessionModels>;
type NewSessionFlowApi = ReturnType<typeof useNewSessionFlow>;

export interface AgentCommandsDeps {
  isNew: boolean;
  session: SessionInfo | null;
  newSessionCwd: string | null;
  newSessionDraftKey: string | null;
  composerDraftKey: string | undefined;
  // Composition-root refs.
  sessionIdRef: RefObject<string | null>;
  promptRunIdRef: RefObject<number>;
  optimisticUserMessageKeyRef: RefObject<string | null>;
  draftKeyAliasesRef: RefObject<Map<string, string>>;
  executeBashRef: RefObject<((command: string, excludeFromContext: boolean) => Promise<void> | undefined) | undefined>;
  bashRunningRef: RefObject<boolean>;
  setBashRunning: Dispatch<SetStateAction<boolean>>;
  setPendingBash: Dispatch<SetStateAction<{ command: string; excludeFromContext: boolean } | null>>;
  // Module APIs.
  stream: EventStreamApi;
  loader: SessionLoaderApi;
  models: SessionModelsApi;
  sessionFlow: NewSessionFlowApi;
  addNotice: (notice: { id?: string; message: string; type?: NoticeType }) => void;
  pendingScrollToUserRef: RefObject<boolean>;
  setPromptAnchorActive: (active: boolean) => void;
  commitAgentPhase: (next: import("./types").AgentPhase) => void;
  flushPendingDeltas: () => void;
  flushPendingPhase: () => void;
  dispatch: Dispatch<import("@/lib/streaming-message").StreamAction>;
  // Facade-owned state.
  toolPreset: ToolPreset;
  setToolPresetState: (preset: ToolPreset) => void;
  queueModes: QueueModes;
  setQueueModes: Dispatch<SetStateAction<QueueModes>>;
  fastModeEnabledRef: RefObject<boolean>;
  setFastModeEnabled: Dispatch<SetStateAction<boolean>>;
  setFastModeActive: Dispatch<SetStateAction<boolean>>;
  isCompacting: boolean;
  setIsCompacting: Dispatch<SetStateAction<boolean>>;
  setCompactError: Dispatch<SetStateAction<string | null>>;
  setCompactResult: Dispatch<SetStateAction<CompactResultInfo | null>>;
  setSessionStatsOverride: Dispatch<SetStateAction<SessionStatsInfo | null>>;
  setQueuedMessages: Dispatch<SetStateAction<QueuedMessages>>;
  setSystemPrompt: Dispatch<SetStateAction<string | null>>;
  // Option callbacks.
  onSessionForked?: (newSessionId: string) => void;
  onSessionStatsPanelOpen?: () => void;
  onOpenSettings?: () => void;
  onOpenNewSession?: (cwd: string) => void;
  onOpenPlugins?: () => void;
  onOpenCollab?: () => void;
  chatInputRef?: RefObject<ChatInputHandle | null>;
}

/**
 * User-initiated commands: sending prompts and shell commands, forking and
 * branch navigation, model/thinking/fast-mode/tool-preset/queue-mode
 * controls, compaction and handoff, queued-message recall and the builtin
 * slash-command dispatcher.
 */
export function useAgentCommands(deps: AgentCommandsDeps) {
  const {
    isNew,
    session,
    newSessionCwd,
    newSessionDraftKey,
    composerDraftKey,
    sessionIdRef,
    promptRunIdRef,
    optimisticUserMessageKeyRef,
    draftKeyAliasesRef,
    executeBashRef,
    bashRunningRef,
    setBashRunning,
    setPendingBash,
    stream,
    loader,
    models,
    sessionFlow,
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
    onOpenSettings,
    onOpenNewSession,
    onOpenPlugins,
    onOpenCollab,
    chatInputRef,
  } = deps;

  const {
    agentRunningRef,
    rpcPromptPendingRef,
    setAgentRunning,
    cancelEventStreamGrace,
    closeEvents,
    ensureEventsConnected,
    scheduleEventStreamClose,
    waitForPromptSettlement,
    reconcileAgentState,
    sessionHookMountedRef,
  } = stream;
  const {
    loadSession,
    loadContext,
    setMessages,
    setActiveLeafId,
  } = loader;
  const {
    newSessionModel,
    modelRoles,
    currentModelOverride,
    setCurrentModelOverride,
    setModelSwitching,
    setNewSessionModel,
    setPendingModel,
    setThinkingLevel,
    newSessionModelOverrideRef,
    thinkingLevelOverrideRef,
    modelSwitchPendingRef,
  } = models;
  const {
    ensureNewSession,
    promoteNewSession,
    ensuringNewSessionRef,
    newSessionPromotedRef,
  } = sessionFlow;

  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const [isHandingOff, setIsHandingOff] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [slashCommands, setSlashCommands] = useState<SlashCommandInfo[]>([]);
  const [slashCommandsLoading, setSlashCommandsLoading] = useState(false);

  // Fresh sessions restore the persisted tool-preset and queue-mode
  // preferences until the real session exists; OMP RPC cannot honor
  // restrictive presets, so fall back to the platform default.
  useLayoutEffect(() => {
    if (!isNew || sessionIdRef.current) return;
    const preferred = getPreferredToolPreset();
    // OMP RPC cannot honor restrictive presets; fall back to the platform
    // default so a stale stored preference never shows a fake guardrail.
    setToolPresetState(
      isRestrictiveToolRequest(getToolNamesForPreset(preferred)) ? "default" : preferred,
    );
  }, [isNew, sessionIdRef, setToolPresetState]);

  useLayoutEffect(() => {
    if (!isNew || sessionIdRef.current) return;
    setQueueModes(getPreferredQueueModes());
  }, [isNew, sessionIdRef, setQueueModes]);

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
  }, [draftKeyAliasesRef]);

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
    const input = chatInputRef?.current;
    if (input) {
      input.restoreSubmission(text, draftImages, destinationDraftKey);
    } else if (destinationDraftKey) {
      restoreDraftSubmission(destinationDraftKey, text, draftImages);
    }
  }, [chatInputRef, newSessionDraftKey, newSessionPromotedRef, resolveComposerDraftKey, sessionHookMountedRef]);

  // Opening the System panel is also allowed to initialize an otherwise dormant
  // session. This is deliberately a non-prompt command: it creates no message
  // or model run, but lets users inspect the exact prompt before sending one.
  const loadSystemPrompt = useCallback(async () => {
    const sid = sessionIdRef.current ?? await ensureNewSession();
    if (!sid) return;

    const state = await sendAgentCommand<AgentStateResponse>(sid, { type: "get_state" });
    if (!sessionHookMountedRef.current || sessionIdRef.current !== sid) return;
    setSystemPrompt(state.systemPrompt ?? "");
  }, [ensureNewSession, sessionIdRef, sessionHookMountedRef, setSystemPrompt]);

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
  }, [ensureNewSession, sessionIdRef]);

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
  }, [addNotice, agentRunningRef, bashRunningRef, cancelEventStreamGrace, closeEvents, commitAgentPhase, composerDraftKey, dispatch, ensureEventsConnected, ensureNewSession, ensuringNewSessionRef, executeBashRef, flushPendingDeltas, flushPendingPhase, isNew, newSessionCwd, newSessionModel, optimisticUserMessageKeyRef, pendingScrollToUserRef, promptRunIdRef, promoteNewSession, reconcileAgentState, restoreSubmission, rpcPromptPendingRef, session, sessionIdRef, setAgentRunning, setMessages, setPendingModel, setPromptAnchorActive, waitForPromptSettlement]);

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
  }, [addNotice, agentRunningRef, bashRunningRef, composerDraftKey, ensureNewSession, loadSession, promoteNewSession, restoreSubmission, session, sessionIdRef, setBashRunning, setPendingBash]);
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
  }, [bashRunningRef, sessionIdRef]);

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
  }, [addNotice, bashRunningRef, onSessionForked, sessionIdRef]);

  const handleNavigate = useCallback(async (entryId: string) => {
    if (bashRunningRef.current) return;
    const sid = sessionIdRef.current;
    if (!sid) return;
    sendAgentCommand(sid, { type: "navigate_tree", targetId: entryId }).catch(() => {});
    setActiveLeafId(entryId);
    await loadContext(sid, entryId);
  }, [bashRunningRef, loadContext, setActiveLeafId, sessionIdRef]);

  const handleLeafChange = useCallback(async (leafId: string | null) => {
    if (bashRunningRef.current) return;
    setActiveLeafId(leafId);
    const sid = sessionIdRef.current;
    if (!sid) return;
    await loadContext(sid, leafId);
    if (leafId) {
      sendAgentCommand(sid, { type: "navigate_tree", targetId: leafId }).catch(() => {});
    }
  }, [bashRunningRef, loadContext, setActiveLeafId, sessionIdRef]);

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
  }, [addNotice, currentModelOverride, ensuringNewSessionRef, isNew, loadSession, modelSwitchPendingRef, newSessionModelOverrideRef, sessionIdRef, setCurrentModelOverride, setModelSwitching, setNewSessionModel, setPendingModel]);

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
  }, [isCompacting, loadSession, sessionIdRef, setCompactError, setCompactResult, setIsCompacting]);

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
  }, [addNotice, isHandingOff, loadSession, onSessionForked, sessionIdRef]);

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
          onOpenSettings?.();
          return complete({ handled: true, message: "Opened settings" });
        }

        case "new": {
          const cwd = session?.cwd ?? newSessionCwd;
          if (!cwd) return complete({ handled: true, error: "No working directory for a new session" });
          onOpenNewSession?.(cwd);
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
          onOpenPlugins?.();
          return complete({ handled: true, message: "Opened extensions" });
        }

        case "collab": {
          onOpenCollab?.();
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
  }, [addNotice, agentRunningRef, cancelEventStreamGrace, ensureEventsConnected, ensureNewSession, handleHandoff, isCompacting, loadSession, newSessionCwd, onOpenCollab, onOpenNewSession, onOpenPlugins, onOpenSettings, onSessionStatsPanelOpen, promoteNewSession, scheduleEventStreamClose, session?.cwd, sessionIdRef, setCompactError, setCompactResult, setIsCompacting, setSessionStatsOverride, slashCommands]);

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
  }, [addNotice, composerDraftKey, restoreSubmission, sessionIdRef]);

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
  }, [addNotice, sessionIdRef]);

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
        chatInputRef?.current?.prependText(texts.join("\n\n"));
      }
    } catch (e) {
      console.error("Failed to recall queued messages:", e);
      const message = e instanceof AgentCommandError && e.code === "capability_unavailable"
        ? (e.message || "Clearing queued messages is not supported in OMP RPC mode.")
        : "Failed to recall queued messages";
      addNotice({ type: "error", message });
    }
  }, [addNotice, chatInputRef, sessionIdRef, setQueuedMessages]);

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
  }, [ensuringNewSessionRef, isNew, sessionIdRef, setThinkingLevel, thinkingLevelOverrideRef]);

  const handleModelRoleChange = useCallback(async (roleName: string) => {
    const role = modelRoles.find((r) => r.name === roleName);
    if (!role) return;
    await handleModelChange(role.provider, role.modelId);
    if (role.thinkingLevel && role.thinkingLevel !== "auto") {
      await handleThinkingLevelChange(role.thinkingLevel as ThinkingLevelOption);
    }
  }, [handleModelChange, handleThinkingLevelChange, modelRoles]);

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
  }, [ensuringNewSessionRef, fastModeEnabledRef, sessionIdRef, setFastModeActive, setFastModeEnabled]);

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
  }, [addNotice, ensuringNewSessionRef, sessionIdRef, setToolPresetState, toolPreset]);

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
  }, [addNotice, ensuringNewSessionRef, queueModes, sessionIdRef, setQueueModes]);

  return {
    forkingEntryId, setForkingEntryId,
    isHandingOff, handoffError,
    slashCommands, slashCommandsLoading,
    resolveComposerDraftKey,
    restoreSubmission,
    loadSystemPrompt,
    loadSlashCommands,
    handleSend, executeBash, handleAbort, handleFork, handleNavigate, handleLeafChange,
    handleModelChange, handleModelRoleChange,
    handleCompact, handleHandoff,
    handleBuiltinSlashCommand,
    handleSteer, handleFollowUp, handlePromptWithStreamingBehavior,
    handleAbortCompaction, handleRecallQueue,
    handleThinkingLevelChange, handleFastModeChange, handleToolPresetChange, handleQueueModeChange,
  };
}
