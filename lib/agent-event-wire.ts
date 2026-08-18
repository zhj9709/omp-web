// Event wire types and transformation — no SDK dependency.

export interface AgentEventLike {
  type: string;
  [key: string]: unknown;
}

/** Generic assistant message event (text_delta, thinking_delta, toolcall_start, toolcall_delta, etc.) */
export interface ClientAssistantMessageEvent {
  type: string;
  id?: string;
  toolName?: string;
  contentIndex: number;
  content: string;
  toolCall: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  };
  [key: string]: unknown;
}

export interface ClientMessageUpdateEvent {
  type: "message_update";
  assistantMessageEvent: ClientAssistantMessageEvent;
  message?: unknown;
  [key: string]: unknown;
}

const OMITTED_EVENT_TYPES = new Set([
  "turn_start",
  "turn_end",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolCallMetadata(
  event: Record<string, unknown>,
): { id: string; toolName: string } | null {
  if (
    (event.type !== "toolcall_start" && event.type !== "toolcall_delta")
    || !isObject(event.partial)
  ) return null;
  const content = event.partial.content;
  // OMP sends contentIndex as string ("0", "1"); normalize before indexing,
  // mirroring the projection in toClientAgentEvent. A non-integer index (or a
  // string that fails to parse) means no metadata can be extracted.
  const rawIndex = event.contentIndex;
  const contentIndex = typeof rawIndex === "string"
    ? parseInt(rawIndex, 10)
    : (typeof rawIndex === "number" ? rawIndex : Number.NaN);
  if (!Array.isArray(content) || !Number.isInteger(contentIndex)) return null;

  const block = content[contentIndex];
  if (!isObject(block) || block.type !== "toolCall") return null;
  const id = typeof block.id === "string"
    ? block.id
    : (typeof block.toolCallId === "string" ? block.toolCallId : null);
  const toolName = typeof block.name === "string"
    ? block.name
    : (typeof block.toolName === "string" ? block.toolName : null);
  return id !== null && toolName !== null ? { id, toolName } : null;
}

/** Reduce a `ttsr_triggered` rules array to just rule names for the wire. */
function ttsrRuleNames(rules: unknown): string[] {
  if (!Array.isArray(rules)) return [];
  const names: string[] = [];
  for (const rule of rules) {
    if (isObject(rule) && typeof rule.name === "string" && rule.name) {
      names.push(rule.name);
    } else if (typeof rule === "string" && rule) {
      names.push(rule);
    }
  }
  return names;
}

/** Apply omp-web's event filters plus Pi 0.84's message_update projection. */
export function toClientAgentEvent(
  event: AgentEventLike,
): AgentEventLike | ClientMessageUpdateEvent | null {
  if (OMITTED_EVENT_TYPES.has(event.type)) return null;

  if (event.type === "message_update") {
    const assistantMessageEvent = event.assistantMessageEvent;
    if (
      typeof assistantMessageEvent !== "object"
      || assistantMessageEvent === null
      || Array.isArray(assistantMessageEvent)
    ) return null;

    // OMP sends contentIndex as string ("0", "1"); normalize to number
    const rawEvent = assistantMessageEvent as Record<string, unknown>;
    const contentIndex = typeof rawEvent.contentIndex === "string"
      ? parseInt(rawEvent.contentIndex, 10)
      : (rawEvent.contentIndex as number | undefined);

    if (!("partial" in assistantMessageEvent)) {
      return {
        type: "message_update",
        assistantMessageEvent: {
          ...assistantMessageEvent,
          contentIndex: Number.isInteger(contentIndex) ? contentIndex : 0,
        },
      } as ClientMessageUpdateEvent;
    }

    const metadata = toolCallMetadata(assistantMessageEvent as Record<string, unknown>);
    const { partial: _partial, ...deltaEvent } = assistantMessageEvent;
    void _partial;
    return {
      type: "message_update",
      assistantMessageEvent: {
        ...deltaEvent,
        contentIndex: Number.isInteger(contentIndex) ? contentIndex : 0,
        ...(metadata ? metadata : {}),
      },
    } as ClientMessageUpdateEvent;
  }

  if (event.type === "tool_execution_update") {
    return {
      type: "tool_execution_update",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      partialResult: event.partialResult,
    };
  }

  if (event.type === "agent_end") return { type: "agent_end" };
  if (event.type === "ttsr_triggered") {
    return { type: "ttsr_triggered", rules: ttsrRuleNames(event.rules) };
  }
  return event;
}

export function isEventIncludedInSnapshot(
  event: AgentEventLike,
  snapshot: unknown,
): boolean {
  return snapshot !== undefined
    && (event.type === "message_start" || event.type === "message_update")
    && event.message === snapshot;
}
