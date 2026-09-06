import type { RefObject } from "react";
import type {
  AgentMessage,
  BlockingExtensionUiRequest,
  ExtensionStatusItem,
  ExtensionUiRequest,
  ExtensionWidgetItem,
  SessionInfo,
  SessionTreeNode,
  UserMessage,
} from "@/lib/types";
import type { ToolPreset } from "@/lib/tool-presets";

export interface SessionData {
  sessionId: string;
  filePath: string;
  totalActiveMs: number;
  tree: SessionTreeNode[];
  leafId: string | null;
  context: {
    messages: AgentMessage[];
    entryIds: string[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  };
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null } | null;
}

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export interface LastAssistantTextResponse {
  text?: string;
}

export type AgentStateResponse = {
  contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  systemPrompt?: string;
  thinkingLevel?: string;
  isStreaming?: boolean;
  isPromptRunning?: boolean;
  isBashRunning?: boolean;
  isCompacting?: boolean;
  extensionStatuses?: ExtensionStatusItem[];
  extensionWidgets?: ExtensionWidgetItem[];
  queuedMessages?: { steering?: string[]; followUp?: string[] } | null;
  fastModeEnabled?: boolean;
  fastModeActive?: boolean;
  steeringMode?: string;
  followUpMode?: string;
  interruptMode?: string;
  todoPhases?: unknown;
  subagentSubscription?: { level: string | null; available: boolean };
};

export interface QueuedMessages {
  steering: string[];
  followUp: string[];
}

export function normalizeQueuedMessages(q?: { steering?: string[]; followUp?: string[] } | null): QueuedMessages {
  return { steering: q?.steering ?? [], followUp: q?.followUp ?? [] };
}

export type ContextUsageInfo = { percent: number | null; contextWindow: number; tokens: number | null };

export type ExtensionUiDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;
export type ExtensionUiCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "thinking" }
  | { kind: "running_command" }
  | { kind: "running_tools"; tools: { id: string; name: string; progress?: string; detail?: string }[] }
  | null;

export interface SlashCommandInfo {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill" | "builtin" | "custom" | "file" | "mcp_prompt";
  sourceInfo?: {
    path: string;
    source: string;
    scope: "user" | "project" | "temporary";
    origin: "package" | "top-level";
    baseDir?: string;
  };
}

export type BuiltinSlashCommandResult =
  | { handled: false }
  | { handled: true; message?: string; error?: string; action?: "openSessionStats" };

export interface UseAgentSessionOptions {
  session: SessionInfo | null;
  sessionRunning?: boolean;
  newSessionCwd: string | null;
  newSessionDraftKey: string | null;
  onAgentEnd?: () => void;
  onAttentionNeeded?: (request: BlockingExtensionUiRequest) => void;
  onSessionCreated?: (session: SessionInfo, sourceDraftKey: string) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  /** Registers an action that lazily starts the session and returns its system prompt. */
  onSystemPromptLoaderChange?: (loader: (() => Promise<void>) | null) => void;
  onSessionStatsPanelOpen?: () => void;
  setToolPreset?: (preset: ToolPreset) => void;
  /** Opens the settings panel (maps the TUI-only /settings command). */
  onOpenSettings?: () => void;
  /** Starts a new session in the given working directory (maps TUI /new). */
  onOpenNewSession?: (cwd: string) => void;
  /** Opens the plugins panel (maps TUI /extensions). */
  onOpenPlugins?: () => void;
  /** Opens the collaboration panel (maps TUI /collab). */
  onOpenCollab?: () => void;
}

export type ThinkingLevelOption = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (content: string) => void;
  replaceMessage: (message: UserMessage) => void;
  prependText: (text: string) => void;
  addImages: (files: File[]) => void;
  rekeyDraft: (previousKey: string, nextKey: string) => void;
  restoreSubmission: (text: string, images?: Array<{ data: string; mimeType: string }>, targetDraftKey?: string) => void;
}

export interface AttachedImage {
  data: string;
  mimeType: string;
  previewUrl: string;
}

export type SelectedModel = { provider: string; modelId: string };
export type ModelEntry = { id: string; name: string; provider: string };
export type ModelRoleEntry = { name: string; provider: string; modelId: string; thinkingLevel: string | null };
export type ModelsResponse = {
  models: Record<string, string>;
  modelList?: ModelEntry[];
  modelRoles?: ModelRoleEntry[];
  defaultModel?: SelectedModel | null;
  thinkingLevels?: Record<string, string[]>;
  thinkingLevelMaps?: Record<string, Record<string, string | null>>;
  thinkingLevelPins?: Record<string, string>;
  modelError?: string;
  modelScopeWarnings?: string[];
};

export type SlashCommandsResponse = {
  commands?: SlashCommandInfo[];
};
