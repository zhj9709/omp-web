"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type {
  ModelEntry,
  ModelRoleEntry,
  ModelsResponse,
  SelectedModel,
  ThinkingLevelOption,
} from "./types";

type ThinkingLevelOverride = Exclude<ThinkingLevelOption, "auto">;

export interface SessionModelsDeps {
  isNew: boolean;
  newSessionCwd: string | null;
  sessionCwd?: string;
  modelsRefreshKey?: number;
  sessionIdRef: RefObject<string | null>;
}

/**
 * Model picker state: the model list/roles/thinking levels loaded from
 * /api/models, the session's current model (override + pending switch), the
 * thinking level, and the new-session model/thinking overrides applied at
 * session creation.
 */
export function useSessionModels(deps: SessionModelsDeps) {
  const {
    isNew,
    newSessionCwd,
    sessionCwd,
    modelsRefreshKey,
    sessionIdRef,
  } = deps;

  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<ModelEntry[]>([]);
  const [modelRoles, setModelRoles] = useState<ModelRoleEntry[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelScopeWarnings, setModelScopeWarnings] = useState<string[]>([]);
  const [modelThinkingLevels, setModelThinkingLevels] = useState<Record<string, string[]>>({});
  const [modelThinkingLevelMaps, setModelThinkingLevelMaps] = useState<Record<string, Record<string, string | null>>>({});
  const [newSessionModel, setNewSessionModel] = useState<SelectedModel | null>(null);
  const [newSessionDefaultModel, setNewSessionDefaultModel] = useState<SelectedModel | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevelOption>("auto");
  const [pendingModel, setPendingModel] = useState<SelectedModel | null>(null);
  const [currentModelOverride, setCurrentModelOverride] = useState<SelectedModel | null>(null);
  const [modelSwitching, setModelSwitching] = useState(false);
  const newSessionModelOverrideRef = useRef<SelectedModel | null>(null);
  const thinkingLevelOverrideRef = useRef<ThinkingLevelOverride | null>(null);
  const modelSwitchPendingRef = useRef(false);

  const loadModels = useCallback(async (signal?: AbortSignal) => {
    const modelCwd = newSessionCwd ?? sessionCwd ?? "";
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
  }, [isNew, newSessionCwd, sessionCwd, sessionIdRef]);

  // Load model list
  useEffect(() => {
    const controller = new AbortController();
    loadModels(controller.signal).catch((e) => {
      if (e instanceof DOMException && e.name === "AbortError") return;
    });
    return () => controller.abort();
  }, [loadModels, modelsRefreshKey]);

  return {
    modelNames,
    modelList,
    modelRoles,
    modelError,
    modelScopeWarnings,
    modelThinkingLevels,
    modelThinkingLevelMaps,
    newSessionModel, setNewSessionModel,
    newSessionDefaultModel, setNewSessionDefaultModel,
    thinkingLevel, setThinkingLevel,
    pendingModel, setPendingModel,
    currentModelOverride, setCurrentModelOverride,
    modelSwitching, setModelSwitching,
    newSessionModelOverrideRef,
    thinkingLevelOverrideRef,
    modelSwitchPendingRef,
    loadModels,
  };
}
