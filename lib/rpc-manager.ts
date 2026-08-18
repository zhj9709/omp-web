/**
 * OMP RPC session manager — replaces the pi SDK AgentSession with
 * an `omp --mode rpc` child process. Preserves the public API contract
 * expected by agent routes, SSE, and the frontend.
 *
 * Architecture:
 *   OmpSessionWrapper wraps an OmpRpcClient, maps pi-web commands to
 *   OMP RPC commands, and forwards session/agent events to subscribers.
 *
 * Never imports @oh-my-pi, @earendil-works, or any Bun-only runtime.
 */

import { existsSync, realpathSync } from "fs";
import { resolve } from "path";
import { OmpRpcClient, type OmpEvent, type RpcCommand, type RpcResponse } from "./rpc-client";
import { validateAgentImages } from "./image-attachments";
import { invalidateSessionListCache } from "./session-reader";
import type { SessionInfo } from "./types";

// ---------------------------------------------------------------------------
// Types (public contract, preserved from pi-web)
// ---------------------------------------------------------------------------

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;

export interface RpcSessionStartOptions {
  initialModel?: { provider: string; modelId: string };
  thinkingLevel?: string;
  steeringMode?: "all" | "one-at-a-time";
  followUpMode?: "all" | "one-at-a-time";
  interruptMode?: "immediate" | "wait";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

const RUNNING_STATE_EVENT_TYPES = new Set([
  "agent_start",
  "agent_end",
  "agent_settled",
  "auto_compaction_start",
  "auto_compaction_end",
  "compaction_start",
  "compaction_end",
]);

const IDLE_RESET_EVENT_TYPES = new Set([
  "agent_end",
  "agent_settled",
  "auto_compaction_end",
  "compaction_end",
]);

// ---------------------------------------------------------------------------
// Command mapping: pi-web → OMP RPC
// ---------------------------------------------------------------------------

/** Commands that map directly 1:1 to OMP RPC. */
const DIRECT_COMMANDS: Record<string, string> = {
  prompt: "prompt",
  steer: "steer",
  follow_up: "follow_up",
  abort: "abort",
  get_state: "get_state",
  set_model: "set_model",
  set_thinking_level: "set_thinking_level",
  compact: "compact",
  set_session_name: "set_session_name",
  get_session_stats: "get_session_stats",
  get_last_assistant_text: "get_last_assistant_text",
  set_auto_compaction: "set_auto_compaction",
  set_auto_retry: "set_auto_retry",
  bash: "bash",
  abort_bash: "abort_bash",
  get_available_commands: "get_available_commands",
  set_steering_mode: "set_steering_mode",
  set_follow_up_mode: "set_follow_up_mode",
  set_interrupt_mode: "set_interrupt_mode",
  set_todos: "set_todos",
  set_subagent_subscription: "set_subagent_subscription",
  get_subagents: "get_subagents",
  get_subagent_messages: "get_subagent_messages",
};

/** Commands that have no OMP RPC equivalent. */
const UNSUPPORTED_COMMANDS = new Set([
  "abort_compaction",
  "clear_queue",
  "reload",
  "extension_ui_input",
]);

/**
 * Extract the leading slash-command name from a prompt message, e.g.
 * "/model foo" -> "model", "/skill:review --file x" -> "skill:review".
 * Returns "" when the message is not a slash command.
 */
function extractCommandName(message: string): string {
  const match = message.match(/^\/([^\s]+)/);
  return match ? match[1] : "";
}

/**
 * Thrown when a pi-web feature has no OMP RPC equivalent. Routes surface this
 * as a machine-readable `code: "capability_unavailable"` so the UI can stop
 * claiming a guardrail is active when it cannot be enforced.
 */
export class CapabilityUnavailableError extends Error {
  readonly code = "capability_unavailable";
  readonly feature: string;
  constructor(feature: string, message: string) {
    super(message);
    this.name = "CapabilityUnavailableError";
    this.feature = feature;
  }
}

// ---------------------------------------------------------------------------
// OmpSessionWrapper
// ---------------------------------------------------------------------------

export class OmpSessionWrapper {
  private listeners: EventListener[] = [];
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onDestroyCallback: (() => void) | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private _alive = true;

  // Tracked state
  private _sessionId: string;
  private _sessionFile: string;
  private _cwd: string;
  private _isStreaming = false;
  private _isCompacting = false;
  private _isBashRunning = false;
  private _pendingPromptCount = 0;
  private _autoRetryEnabled = true;
  private promptAdmissionTail: Promise<void> = Promise.resolve();

  // Tracked sub-state
  private _model: { provider: string; id: string } | undefined;
  private _thinkingLevel = "off";
  private _sessionName = "";
  private _autoCompactionEnabled = true;
  private _fastModeEnabled = false;
  private _fastModeActive = false;
  private _messageCount = 0;
  private _contextUsage: { tokens: number | null; contextWindow: number; percent: number | null } | null = null;
  private _queuedSteeringMessages: string[] = [];
  private _queuedFollowUpMessages: string[] = [];
  private _subagentSubscriptionLevel: "off" | "progress" | "events" | null = null;
  private _subagentSubscriptionAvailable = true;

  constructor(
    private readonly client: OmpRpcClient,
    options: {
      sessionId: string;
      sessionFile: string;
      cwd: string;
    },
  ) {
    this._sessionId = options.sessionId;
    this._sessionFile = options.sessionFile;
    this._cwd = options.cwd;
  }

  // -- accessors -------------------------------------------------------------

  get sessionId(): string {
    return this._sessionId;
  }

  get sessionFile(): string {
    return this._sessionFile;
  }

  get cwd(): string {
    return this._cwd;
  }

  get isStreaming(): boolean {
    return this._isStreaming;
  }

  get streamingMessage(): unknown {
    return undefined; // OMP doesn't expose this on the wrapper
  }

  isAlive(): boolean {
    return this._alive;
  }

  isRunning(): boolean {
    return (
      this._alive &&
      (this._pendingPromptCount > 0 ||
        this._isStreaming ||
        this._isCompacting ||
        this._isBashRunning)
    );
  }

  // -- lifecycle -------------------------------------------------------------

  start(): void {
    this.unsubscribe = this.client.onEvent((event: OmpEvent) => {
      this.handleOmpEvent(event);
    });

    // Sync initial state from OMP
    this.syncState().catch((err) => {
      console.error(
        "[omp-web] failed to sync initial state:",
        err instanceof Error ? err.message : err,
      );
    });

    // Forward subagent lifecycle/progress/event frames so the frontend can
    // render a live roster. "events" includes everything "progress" does plus
    // full subagent event frames. Track the requested level so the frontend
    // can report subagent availability when the subscription fails.
    const subagentLevel = "events";
    this._subagentSubscriptionLevel = subagentLevel;
    this.client
      .sendCommand({ type: "set_subagent_subscription", level: subagentLevel })
      .then(() => {
        this._subagentSubscriptionAvailable = true;
      })
      .catch((err) => {
        this._subagentSubscriptionAvailable = false;
        console.error(
          "[omp-web] failed to enable subagent subscription:",
          err instanceof Error ? err.message : err,
        );
      });

    this.resetIdleTimer();
    notifyRunningChange();
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallback = cb;
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    if (!this._alive) return;

    this.shutdownPromise = (async () => {
      try {
        this.client.dispose();
      } finally {
        this.destroy();
      }
    })();
    return this.shutdownPromise;
  }

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.unsubscribe?.();
    try {
      this.onDestroyCallback?.();
    } finally {
      notifyRunningChange();
    }
  }

  // -- send ------------------------------------------------------------------

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer();
    const type = command.type as string;

    // Validate images for prompt commands
    if (type === "prompt" || type === "steer" || type === "follow_up") {
      const imageError = validateAgentImages(command.images);
      if (imageError) throw new Error(imageError);
    }

    switch (type) {
      // --- prompting ---
      case "prompt": {
        const releaseAdmission = await this.acquirePromptAdmission();
        try {
          if (this._isBashRunning) {
            throw new Error("Cannot send a prompt while a shell command is running");
          }

          this._pendingPromptCount += 1;
          notifyRunningChange();

          const rpcCmd: RpcCommand = {
            type: "prompt",
            message: command.message,
          };
          if (command.images) rpcCmd.images = command.images;
          if (command.streamingBehavior) {
            rpcCmd.streamingBehavior = command.streamingBehavior;
          }

          try {
            const response = await this.client.send(rpcCmd);
            if (!response.success) {
              throw new Error(response.error ?? "prompt failed");
            }
            // Check agentInvoked
            const data = response.data as
              | { agentInvoked?: boolean }
              | undefined;
            if (data?.agentInvoked === false) {
              this.emit({ type: "prompt_done" });
              // OMP intercepted a registered slash command and executed it
              // natively. Report which command so the caller can surface it
              // instead of silently swallowing the response.
              return {
                agentInvoked: false,
                command: extractCommandName(command.message as string),
              };
            }
            // If agentInvoked is true or absent, agent_end will signal completion
          } finally {
            this._pendingPromptCount = Math.max(0, this._pendingPromptCount - 1);
            this.resetIdleTimer();
            notifyRunningChange();
          }
          return null;
        } finally {
          releaseAdmission();
        }
      }

      case "steer":
      case "follow_up": {
        const rpcCmd: RpcCommand = {
          type,
          message: command.message,
        };
        if (command.images) rpcCmd.images = command.images;
        await this.client.sendCommand(rpcCmd);
        return null;
      }

      case "abort": {
        await this.client.sendCommand({ type: "abort" });
        return null;
      }

      // --- state ---
      case "get_state": {
        const raw = await this.client.sendCommand<Record<string, unknown>>({
          type: "get_state",
        });
        return this.mapGetState(raw);
      }

      // --- model ---
      case "set_model": {
        const { provider, modelId } = command as {
          provider: string;
          modelId: string;
        };
        const raw = await this.client.sendCommand<Record<string, unknown>>({
          type: "set_model",
          provider,
          modelId,
        });
        const model = (raw as { model?: { provider: string; id: string } })
          ?.model ?? { provider, id: modelId };
        this._model = { provider: model.provider, id: model.id };
        return { id: model.id, provider: model.provider };
      }

      case "set_thinking_level": {
        const level = command.level as string;
        await this.client.sendCommand({
          type: "set_thinking_level",
          level,
        });
        this._thinkingLevel = level;
        invalidateSessionListCache();
        return null;
      }

      // --- compaction ---
      case "compact": {
        try {
          const result = await this.client.sendCommand({
            type: "compact",
            ...(command.customInstructions
              ? { customInstructions: command.customInstructions }
              : {}),
          });
          return result;
        } finally {
          invalidateSessionListCache();
        }
      }

      case "set_auto_compaction": {
        await this.client.sendCommand({
          type: "set_auto_compaction",
          enabled: command.enabled,
        });
        this._autoCompactionEnabled = command.enabled as boolean;
        return null;
      }

      // --- retry ---
      case "set_auto_retry": {
        await this.client.sendCommand({
          type: "set_auto_retry",
          enabled: command.enabled,
        });
        this._autoRetryEnabled = command.enabled as boolean;
        return null;
      }

      // --- fast mode ---
      case "set_fast_mode": {
        const enabled = command.enabled as boolean;
        const raw = await this.client.sendCommand<{
          enabled: boolean;
          active: boolean;
        }>({
          type: "set_fast_mode",
          enabled,
        });
        this._fastModeEnabled = raw.enabled;
        this._fastModeActive = raw.active;
        return { enabled: raw.enabled, active: raw.active };
      }

      // --- session ---
      case "set_session_name": {
        const name = (command.name as string | undefined)?.trim();
        if (!name) throw new Error("Session name cannot be empty");
        await this.client.sendCommand({
          type: "set_session_name",
          name,
        });
        this._sessionName = name;
        invalidateSessionListCache();
        return null;
      }

      case "get_session_stats": {
        const raw = await this.client.sendCommand<Record<string, unknown>>({
          type: "get_session_stats",
        });
        return { ...raw, sessionName: this._sessionName };
      }

      case "get_last_assistant_text": {
        const raw = await this.client.sendCommand<{ text?: string }>({
          type: "get_last_assistant_text",
        });
        return { text: raw.text ?? "" };
      }

      case "export_html": {
        const outputPath = command.outputPath as string | undefined;
        const raw = await this.client.sendCommand<{ path?: string }>({
          type: "export_html",
          ...(outputPath ? { outputPath } : {}),
        });
        return { path: raw.path ?? "" };
      }

      // --- handoff ---
      case "handoff": {
        // Share the prompt admission lock so a handoff cannot slip in while a
        // prompt is queued (admitted) but has not yet incremented the pending
        // prompt count.
        const releaseAdmission = await this.acquirePromptAdmission();
        try {
          if (
            this._isStreaming ||
            this._pendingPromptCount > 0 ||
            this._isCompacting ||
            this._isBashRunning
          ) {
            throw new Error("Cannot hand off while the session is busy");
          }

          const previousId = this._sessionId;
          const result = await this.client.sendCommand<{ savedPath?: string }>({
            type: "handoff",
            ...(command.customInstructions
              ? { customInstructions: command.customInstructions }
              : {}),
          });

          // Handoff switches the RPC process to a brand-new child session.
          // Re-sync so the wrapper tracks the new id/file, then re-key the
          // registry so future lookups for the new id reuse this live process.
          await this.syncStateStrict();

          // A successful handoff must produce a new session id. If it did not
          // (e.g. the RPC handoff silently no-oped), fail explicitly so the
          // caller does not keep pointing at the old session id.
          if (!this._sessionId || this._sessionId === previousId) {
            throw new Error("Handoff did not create a new session");
          }

          this.rebindRegistryKey(previousId);
          invalidateSessionListCache();
          return {
            savedPath: result?.savedPath,
            sessionId: this._sessionId,
            sessionFile: this._sessionFile,
          };
        } finally {
          releaseAdmission();
        }
      }

      // --- fork / navigate ---
      case "fork": {
        if (this._isBashRunning) {
          throw new Error("Cannot fork while a shell command is running");
        }

        const entryId = command.entryId as string;
        if (!entryId) throw new Error("entryId is required for fork");

        // OMP RPC `new_session` only accepts `parentSession` and forks the
        // entire transcript; it has no entryId/fromEntryId parameter to
        // truncate history at a specific message. Silently forking the whole
        // session would hand the caller a different history than requested, so
        // fail explicitly instead.
        throw new CapabilityUnavailableError(
          "fork_at_entry",
          "Forking at a specific message is not supported in OMP RPC mode.",
        );
      }

      case "navigate_tree": {
        if (this._isBashRunning) {
          throw new Error("Cannot navigate while a shell command is running");
        }
        const entryId = command.targetId as string;
        const response = await this.client.send({
          type: "branch",
          entryId,
        });
        if (!response.success) {
          throw new Error(response.error ?? "navigate_tree failed");
        }
        return { cancelled: false };
      }

      // --- tools ---
      case "get_tools": {
        const raw = await this.client.sendCommand<{
          dumpTools?: Array<{
            name: string;
            description: string;
          }>;
        }>({ type: "get_state" });
        const tools = raw.dumpTools ?? [];
        return tools.map((t) => ({
          name: t.name,
          description: t.description,
          active: true, // OMP doesn't expose per-tool active state; all are active
        }));
      }

      case "get_commands": {
        const raw = await this.client.sendCommand<{
          commands?: Array<{
            name: string;
            source: string;
            description?: string;
            aliases?: string[];
            input?: { hint?: string };
            subcommands?: unknown[];
          }>;
        }>({ type: "get_available_commands" });
        const commands = raw.commands ?? [];
        return {
          commands: commands.map((c) => ({
            name: c.name,
            description: c.description ?? "",
            source: c.source,
            sourceInfo: c.aliases?.join(", ") ?? "",
          })),
        };
      }

      case "set_tools": {
        // OMP doesn't support per-session tool filtering via RPC.
        // set_host_tools only adds host-owned tools, and the spawn-time
        // --tools flag rejects pi tool names (bash/edit/find/ls are not valid
        // OMP entries), so no requested preset can be applied here. Never
        // return success: the UI must not show a preset as enforced when it
        // is not.
        throw new Error(
          "Tool filtering is not supported in OMP RPC mode. " +
            "Use the OMP CLI to configure tool access.",
        );
      }

      // --- bash ---
      case "bash": {
        if (
          this._pendingPromptCount > 0 ||
          this._isStreaming ||
          this._isCompacting ||
          this._isBashRunning
        ) {
          throw new Error("Cannot run a shell command while the session is busy");
        }

        this._isBashRunning = true;
        notifyRunningChange();
        try {
          const result = await this.client.sendCommand<Record<string, unknown>>(
            {
              type: "bash",
              command: command.command,
            },
          );
          return result;
        } finally {
          this._isBashRunning = false;
          this.resetIdleTimer();
          invalidateSessionListCache();
          notifyRunningChange();
        }
      }

      case "abort_bash": {
        await this.client.sendCommand({ type: "abort_bash" });
        return null;
      }

      // --- extension UI ---
      case "extension_ui_response": {
        // Forward to OMP
        const { type: _, ...response } = command as Record<string, unknown>;
        this.client.send({
          type: "extension_ui_response",
          ...response,
        }).catch((err) => {
          console.error(
            "[omp-web] extension_ui_response failed:",
            err instanceof Error ? err.message : err,
          );
        });
        return null;
      }

      // --- unsupported ---
      default: {
        if (UNSUPPORTED_COMMANDS.has(type)) {
          throw new CapabilityUnavailableError(
            type,
            `Command "${type}" is not supported in OMP RPC mode.`,
          );
        }
        // Try direct mapping
        const ompType = DIRECT_COMMANDS[type];
        if (ompType) {
          const { type: _, ...rest } = command;
          const result = await this.client.sendCommand({
            type: ompType,
            ...rest,
          });
          return result;
        }
        throw new Error(`Unsupported command: ${type}`);
      }
    }
  }
  /**
   * Raw OMP model connection for server-side model calls (e.g. title
   * generation). Deliberately separate from the mapped `get_state` output:
   * `headers` may contain an API key and must never reach the browser.
   */
  async getModelConnection(): Promise<
    | {
        id: string;
        baseUrl?: string;
        api?: string;
        headers: Record<string, string>;
      }
    | undefined
  > {
    const raw = await this.client.sendCommand<Record<string, unknown>>({
      type: "get_state",
    });
    const model = raw.model as
      | {
          id?: string;
          baseUrl?: string;
          api?: string;
          headers?: unknown;
        }
      | undefined;
    if (!model?.id) return undefined;

    const headers: Record<string, string> = {};
    if (typeof model.headers === "object" && model.headers !== null) {
      for (const [key, value] of Object.entries(model.headers)) {
        if (typeof value === "string") headers[key] = value;
      }
    }

    return {
      id: model.id,
      baseUrl: typeof model.baseUrl === "string" ? model.baseUrl : undefined,
      api: typeof model.api === "string" ? model.api : undefined,
      headers,
    };
  }

  // -- internals -------------------------------------------------------------

  private async syncState(): Promise<void> {
    try {
      await this.syncStateStrict();
    } catch {
      // Initial sync is best-effort
    }
  }

  /**
   * Sync wrapper state from OMP, throwing on failure. Callers that mutate the
   * session identity (e.g. handoff) must use this variant: swallowing the error
   * there would leave the wrapper tracking a stale session id/file.
   */
  private async syncStateStrict(): Promise<void> {
    const raw = await this.client.sendCommand<Record<string, unknown>>({
      type: "get_state",
    });
    const state = this.mapGetState(raw);
    this._sessionId = state.sessionId as string;
    this._sessionFile = state.sessionFile as string;
    this._isStreaming = state.isStreaming as boolean;
    this._isCompacting = state.isCompacting as boolean;
    this._autoCompactionEnabled = state.autoCompactionEnabled as boolean;
    this._fastModeEnabled = (raw.fastModeEnabled as boolean) ?? false;
    this._fastModeActive = (raw.fastModeActive as boolean) ?? false;
    this._messageCount = state.messageCount as number;
    this._thinkingLevel = state.thinkingLevel as string;
    this._sessionName = (raw.sessionName as string) ?? "";
    if (state.model) {
      this._model = state.model as { provider: string; id: string };
    }
    if (state.contextUsage) {
      this._contextUsage = state.contextUsage as {
        tokens: number | null;
        contextWindow: number;
        percent: number | null;
      };
    }
  }

  /**
   * Move the wrapper's registry entry to its current session id. Handoff
   * switches the RPC process to a brand-new child session, so the old key is
   * dropped and the new id must resolve to this still-live wrapper.
   */
  private rebindRegistryKey(previousId: string): void {
    const registry = getRegistry();
    const newId = this._sessionId;
    if (!newId || newId === previousId) return;
    if (registry.get(previousId) === this) registry.delete(previousId);
    registry.set(newId, this);
    // Destroy must remove the current key, not the original one.
    this.onDestroyCallback = () => registry.delete(newId);
  }

  private handleOmpEvent(event: OmpEvent): void {
    // Track state from events
    switch (event.type) {
      case "agent_start":
        this._isStreaming = true;
        break;
      case "agent_end": {
        this._isStreaming = false;
        const isTerminal = (event as { isTerminal?: boolean }).isTerminal;
        if (isTerminal !== false) {
          this.emit({ type: "prompt_done" });
        }
        invalidateSessionListCache();
        break;
      }
      case "agent_settled":
        this._isStreaming = false;
        break;
      case "compaction_start":
      case "auto_compaction_start":
        this._isCompacting = true;
        break;
      case "compaction_end":
      case "auto_compaction_end":
        this._isCompacting = false;
        break;
      case "model_changed":
        this._model = {
          provider: (event as { provider?: string }).provider ?? "",
          id: (event as { modelId?: string }).modelId ?? "",
        };
        break;
      case "thinking_level_changed":
        this._thinkingLevel =
          (event as { level?: string }).level ?? "off";
        break;
      case "message_update":
        // Track streaming message count
        break;
      case "message_end":
        this._messageCount++;
        break;
      case "queue_update": {
        const queueEvent = event as { steering?: unknown; followUp?: unknown };
        this._queuedSteeringMessages = Array.isArray(queueEvent.steering)
          ? queueEvent.steering.filter((m): m is string => typeof m === "string")
          : [];
        this._queuedFollowUpMessages = Array.isArray(queueEvent.followUp)
          ? queueEvent.followUp.filter((m): m is string => typeof m === "string")
          : [];
        break;
      }
    }

    if (IDLE_RESET_EVENT_TYPES.has(event.type)) {
      this.resetIdleTimer();
    }

    // Forward to listeners
    this.emit(event as AgentEvent);

    if (RUNNING_STATE_EVENT_TYPES.has(event.type)) {
      notifyRunningChange();
    }
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(
          "[omp-web] failed to deliver event:",
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  private async acquirePromptAdmission(): Promise<() => void> {
    const previous = this.promptAdmissionTail;
    const { promise, resolve } = Promise.withResolvers<void>();
    this.promptAdmissionTail = promise;
    await previous;
    return resolve;
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.isRunning()) {
        this.resetIdleTimer();
        return;
      }
      void this.shutdown().catch((error) => {
        console.error(
          "[omp-web] failed to shut down idle session:",
          error instanceof Error ? error.message : error,
        );
      });
    }, IDLE_TIMEOUT_MS);
  }

  /**
   * Map OMP get_state response to pi-web expected shape.
   */
  private mapGetState(raw: Record<string, unknown>): Record<string, unknown> {
    const model = raw.model as
      | { provider: string; id: string }
      | undefined;
    const contextUsage = raw.contextUsage as
      | { tokens: number | null; contextWindow: number; percent: number | null }
      | undefined;
    const systemPrompt = raw.systemPrompt as string[] | string | undefined;

    return {
      sessionId: (raw.sessionId as string) ?? this._sessionId,
      sessionFile: (raw.sessionFile as string) ?? this._sessionFile,
      isStreaming: (raw.isStreaming as boolean) ?? this._isStreaming,
      isPromptRunning: this._pendingPromptCount > 0,
      isBashRunning: this._isBashRunning,
      isCompacting: (raw.isCompacting as boolean) ?? this._isCompacting,
      autoCompactionEnabled:
        (raw.autoCompactionEnabled as boolean) ?? this._autoCompactionEnabled,
      autoRetryEnabled: this._autoRetryEnabled,
      model: model
        ? { id: model.id, provider: model.provider }
        : this._model
          ? { id: this._model.id, provider: this._model.provider }
          : undefined,
      messageCount: (raw.messageCount as number) ?? 0,
      pendingMessageCount: (raw.queuedMessageCount as number) ?? 0,
      queuedMessages: {
        steering: [...this._queuedSteeringMessages],
        followUp: [...this._queuedFollowUpMessages],
      },
      contextUsage: contextUsage
        ? {
            percent: contextUsage.percent,
            contextWindow: contextUsage.contextWindow,
            tokens: contextUsage.tokens,
          }
        : this._contextUsage,
      systemPrompt: Array.isArray(systemPrompt)
        ? systemPrompt.join("\n")
        : (systemPrompt ?? ""),
      thinkingLevel: (raw.thinkingLevel as string) ?? this._thinkingLevel,
      steeringMode: (raw.steeringMode as string) ?? "one-at-a-time",
      followUpMode: (raw.followUpMode as string) ?? "one-at-a-time",
      interruptMode: (raw.interruptMode as string) ?? "immediate",
      todoPhases: Array.isArray(raw.todoPhases) ? raw.todoPhases : [],
      fastModeEnabled:
        (raw.fastModeEnabled as boolean) ?? this._fastModeEnabled,
      fastModeActive:
        (raw.fastModeActive as boolean) ?? this._fastModeActive,
      subagentSubscription: {
        level: this._subagentSubscriptionLevel,
        available: this._subagentSubscriptionAvailable,
      },
      extensionStatuses: [],
      extensionWidgets: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Session registry (globalThis survives Next.js hot-reload)
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __ompSessions: Map<string, OmpSessionWrapper> | undefined;
  // eslint-disable-next-line no-var
  var __ompStartLocks: Map<
    string,
    Promise<{ session: OmpSessionWrapper; realSessionId: string }>
  > | undefined;
  // eslint-disable-next-line no-var
  var __ompRunningListeners: Set<(ids: string[]) => void> | undefined;
}

function getRegistry(): Map<string, OmpSessionWrapper> {
  if (!globalThis.__ompSessions) {
    globalThis.__ompSessions = new Map();
    const cleanup = () =>
      globalThis.__ompSessions?.forEach((s) => {
        try {
          s.shutdown();
        } catch {
          // ignore
        }
      });
    process.once("exit", cleanup);
    // SIGINT/SIGTERM: dispose every live client (terminates the omp child
    // via stdin EOF + SIGTERM), then re-raise so the process still exits with
    // the default signal behavior instead of hanging on the listeners.
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        cleanup();
        try {
          process.kill(process.pid, signal);
        } catch {
          // ignore — fall through to process exit
        }
      });
    }
  }
  return globalThis.__ompSessions;
}

function getLocks(): Map<
  string,
  Promise<{ session: OmpSessionWrapper; realSessionId: string }>
> {
  if (!globalThis.__ompStartLocks) globalThis.__ompStartLocks = new Map();
  return globalThis.__ompStartLocks;
}

function normalizeRpcCwd(cwd: string): string {
  const resolvedCwd = resolve(cwd);
  try {
    return realpathSync(resolvedCwd);
  } catch {
    return resolvedCwd;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getRpcSession(
  sessionId: string,
): OmpSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

/**
 * Get or create an OMP RPC session for the given session.
 * For new sessions (sessionFile === ""), spawns omp in the given cwd.
 * For existing sessions, spawns omp and switches to the session file.
 * Concurrent calls for the same sessionId share a single start Promise.
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string | undefined,
  options: RpcSessionStartOptions = {},
): Promise<{ session: OmpSessionWrapper; realSessionId: string }> {
  const { initialModel, thinkingLevel, steeringMode, followUpMode, interruptMode } = options;
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) {
    return { session: existing, realSessionId: sessionId };
  }

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  const resolvedCwd = cwd ?? process.cwd();

  const starting = (async () => {
    const client = new OmpRpcClient({
      cwd: resolvedCwd,
    });

    try {
      await client.start();

      let realSessionId = sessionId;
      let realSessionFile = sessionFile;

      if (sessionFile) {
        // Existing session: switch to the session file
        await client.sendCommand({ type: "switch_session", sessionPath: sessionFile });
        realSessionFile = sessionFile;
      } else {
        // New session: OMP auto-creates one; get the session ID
        const state = await client.sendCommand<Record<string, unknown>>({
          type: "get_state",
        });
        realSessionId = (state.sessionId as string) ?? sessionId;
        realSessionFile = (state.sessionFile as string) ?? "";
      }

      // Apply initial model if specified
      if (initialModel) {
        await client.sendCommand({
          type: "set_model",
          provider: initialModel.provider,
          modelId: initialModel.modelId,
        });
      }

      // Apply thinking level if specified
      if (thinkingLevel) {
        await client.sendCommand({
          type: "set_thinking_level",
          level: thinkingLevel,
        });
      }

      // Apply queue modes if specified (new-session defaults from the UI)
      if (steeringMode) {
        await client.sendCommand({ type: "set_steering_mode", mode: steeringMode });
      }
      if (followUpMode) {
        await client.sendCommand({ type: "set_follow_up_mode", mode: followUpMode });
      }
      if (interruptMode) {
        await client.sendCommand({ type: "set_interrupt_mode", mode: interruptMode });
      }

      const wrapper = new OmpSessionWrapper(client, {
        sessionId: realSessionId,
        sessionFile: realSessionFile,
        cwd: resolvedCwd,
      });

      wrapper.start();
      wrapper.onDestroy(() => registry.delete(realSessionId));
      registry.set(realSessionId, wrapper);

      return { session: wrapper, realSessionId };
    } catch (error) {
      // Any failure before the wrapper is registered (ready timeout, session
      // switch, model config) must not leak the spawned omp child — it has no
      // registry entry and would never hit the idle-timeout cleanup.
      client.kill();
      throw error;
    }
  })().finally(() => {
    locks.delete(sessionId);
  });

  locks.set(sessionId, starting);
  return starting;
}

export function getRunningRpcSessionIds(): string[] {
  const ids = new Set<string>();
  for (const [sessionId, session] of getRegistry()) {
    if (session.isRunning()) ids.add(session.sessionId || sessionId);
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// Running-status broadcaster
// ---------------------------------------------------------------------------

function getRunningListeners(): Set<(ids: string[]) => void> {
  if (!globalThis.__ompRunningListeners) {
    globalThis.__ompRunningListeners = new Set();
  }
  return globalThis.__ompRunningListeners;
}

export function subscribeRunningSessions(
  listener: (ids: string[]) => void,
): () => void {
  const listeners = getRunningListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let lastRunningSnapshot = "";

export function notifyRunningChange(): void {
  const listeners = getRunningListeners();
  if (listeners.size === 0) {
    lastRunningSnapshot = "";
    return;
  }
  const ids = getRunningRpcSessionIds();
  const snapshot = JSON.stringify([...ids].sort());
  if (snapshot === lastRunningSnapshot) return;
  lastRunningSnapshot = snapshot;
  for (const listener of listeners) {
    try {
      listener(ids);
    } catch {
      // ignore listener errors
    }
  }
}

// ---------------------------------------------------------------------------
// Session info helpers (for session list)
// ---------------------------------------------------------------------------

export function hasBusyRpcSessionForCwd(cwd: string): boolean {
  const targetCwd = normalizeRpcCwd(cwd);
  return Array.from(getRegistry().values()).some(
    (session) =>
      normalizeRpcCwd(session.cwd) === targetCwd && session.isRunning(),
  );
}

export async function destroyRpcSessionsForCwd(
  cwd: string,
): Promise<number> {
  const targetCwd = normalizeRpcCwd(cwd);
  const sessions = Array.from(getRegistry().values()).filter(
    (session) => normalizeRpcCwd(session.cwd) === targetCwd,
  );
  await Promise.all(sessions.map((session) => session.shutdown()));
  return sessions.length;
}

export function getRpcSessionInfos(): SessionInfo[] {
  const sessions: SessionInfo[] = [];
  for (const session of getRegistry().values()) {
    if (!session.isAlive()) continue;
    sessions.push({
      path: session.sessionFile,
      id: session.sessionId,
      cwd: session.cwd,
      name: "",
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      messageCount: 0,
      firstMessage: "(live session)",
      transient: !session.sessionFile || !existsSync(session.sessionFile),
    });
  }
  return sessions;
}