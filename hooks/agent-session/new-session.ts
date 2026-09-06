"use client";

import { useCallback, useRef } from "react";
import type { RefObject } from "react";
import { rekeyDraft } from "@/lib/draft-store";
import { projectIdentityKey } from "@/lib/project-identity";
import { getToolNamesForPreset } from "@/lib/tool-presets";
import type { SessionInfo } from "@/lib/types";
import type { QueueModes } from "@/lib/queue-mode-preference";
import type { SelectedModel, ThinkingLevelOption } from "./types";

type ThinkingLevelOverride = Exclude<ThinkingLevelOption, "auto">;

export interface NewSessionFlowDeps {
  isNew: boolean;
  newSessionCwd: string | null;
  newSessionDraftKey: string | null;
  sessionIdRef: RefObject<string | null>;
  /** Composer draft alias map owned by the composition root. */
  draftKeyAliasesRef: RefObject<Map<string, string>>;
  // Session-creation preferences applied atomically by ensure_session.
  toolPreset: import("@/lib/tool-presets").ToolPreset;
  queueModes: QueueModes;
  setQueueModes: (next: QueueModes) => void;
  // Model state (from useSessionModels).
  newSessionModelOverrideRef: RefObject<SelectedModel | null>;
  thinkingLevelOverrideRef: RefObject<ThinkingLevelOverride | null>;
  setPendingModel: (model: SelectedModel | null) => void;
  setNewSessionDefaultModel: (model: SelectedModel | null) => void;
  setThinkingLevel: (level: ThinkingLevelOption) => void;
  onSessionCreated?: (session: SessionInfo, sourceDraftKey: string) => void;
  chatInputRef?: RefObject<import("./types").ChatInputHandle | null>;
}

/**
 * The fresh new-session flow: lazily creates the backing OMP session on the
 * first prompt (or System panel / slash command), then promotes the
 * provisional draft to the real session id (rekeying drafts and publishing
 * the transient session to the sidebar).
 */
export function useNewSessionFlow(deps: NewSessionFlowDeps) {
  const {
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
    chatInputRef,
  } = deps;

  const ensuringNewSessionRef = useRef<Promise<string | null> | null>(null);
  const newSessionPromotedRef = useRef(false);

  const promoteNewSession = useCallback((messageCount = 0, firstMessage = "(no messages)") => {
    const sid = sessionIdRef.current;
    if (!isNew || !newSessionCwd || !sid || newSessionPromotedRef.current) return;
    newSessionPromotedRef.current = true;
    const provisionalDraftKey = newSessionDraftKey;
    if (!provisionalDraftKey) return;
    if (provisionalDraftKey !== sid) {
      draftKeyAliasesRef.current.set(provisionalDraftKey, sid);
      const input = chatInputRef?.current;
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
  }, [chatInputRef, draftKeyAliasesRef, isNew, newSessionCwd, newSessionDraftKey, onSessionCreated, sessionIdRef]);

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
  }, [isNew, newSessionCwd, newSessionModelOverrideRef, queueModes, sessionIdRef, setNewSessionDefaultModel, setPendingModel, setQueueModes, setThinkingLevel, thinkingLevelOverrideRef, toolPreset]);

  return {
    ensureNewSession,
    promoteNewSession,
    ensuringNewSessionRef,
    newSessionPromotedRef,
  };
}
