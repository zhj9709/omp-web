// Subagent roster types and normalization — no SDK dependency.
//
// OMP forwards subagent state over three frame kinds, all sharing a `payload`
// record (see omp://rpc.md, "Subagent subscriptions"):
//   - subagent_lifecycle: spawn/status transitions
//   - subagent_progress:  progress updates
//   - subagent_event:     full subagent event frames (only at level "events")

export interface SubagentInfo {
  id: string;
  index: number | null;
  label: string;
  description: string;
  status: string;
  kind: string;
  agentType: string | null;
  sessionFile: string | null;
  model: string | null;
  provider: string | null;
  progress: SubagentProgress | null;
  raw: Record<string, unknown>;
}

export interface SubagentProgress {
  /** Human-readable progress text, when the runtime supplies one. */
  text: string | null;
  /** Structured progress fields forwarded verbatim for richer rendering. */
  fields: Record<string, unknown>;
}

export interface SubagentTranscriptMessage {
  role: string;
  content: unknown;
  [key: string]: unknown;
}

export interface SubagentTranscript {
  subagentId: string;
  sessionFile: string | null;
  fromByte: number;
  nextByte: number;
  reset: boolean;
  entries: unknown[];
  messages: SubagentTranscriptMessage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractProgress(value: unknown): SubagentProgress | null {
  if (value === undefined || value === null) return null;
  if (isRecord(value)) {
    const text =
      asString(value.text) ??
      asString(value.message) ??
      asString(value.label) ??
      null;
    return { text, fields: { ...value } };
  }
  if (typeof value === "string" && value.length > 0) {
    return { text: value, fields: {} };
  }
  return null;
}

/**
 * Normalize one subagent registry record (the `get_subagents` snapshot entries
 * and the `payload` of lifecycle/progress/event frames share this shape).
 */
export function normalizeSubagent(raw: unknown): SubagentInfo | null {
  if (!isRecord(raw)) return null;

  // The payload may nest the record under a `subagent` key on some frame kinds.
  const record = isRecord(raw.subagent) ? raw.subagent : raw;

  const id = asString(record.id) ?? asString(record.subagentId);
  if (!id) return null;

  const index = asNumber(record.index);
  const description = asString(record.description) ?? asString(record.goal) ?? "";
  const label =
    asString(record.label) ??
    asString(record.name) ??
    (description
      ? description
      : index !== null
        ? `Subagent #${index}`
        : "Subagent");

  return {
    id,
    index,
    label,
    description,
    status: asString(record.status) ?? "unknown",
    kind: asString(record.kind) ?? "subagent",
    agentType: asString(record.agentType) ?? asString(record.agent) ?? null,
    sessionFile: asString(record.sessionFile) ?? asString(record.childSessionFile) ?? null,
    model: asString(record.model) ?? asString(record.modelId) ?? null,
    provider: asString(record.provider) ?? null,
    progress: extractProgress(record.progress),
    raw: record,
  };
}

/** Extract the record from a subagent lifecycle/progress/event frame, if any. */
export function normalizeSubagentEvent(
  event: { type: string; [key: string]: unknown },
): SubagentInfo | null {
  if (
    event.type !== "subagent_lifecycle" &&
    event.type !== "subagent_progress" &&
    event.type !== "subagent_event"
  ) {
    return null;
  }
  return normalizeSubagent(event.payload);
}

/** Compare two subagents for roster ordering: index first, then id. */
function compareSubagents(a: SubagentInfo, b: SubagentInfo): number {
  if (a.index !== null && b.index !== null && a.index !== b.index) {
    return a.index - b.index;
  }
  return a.id.localeCompare(b.id);
}

/** Upsert a normalized subagent into the roster, preserving sort by index/id. */
export function upsertSubagent(
  roster: SubagentInfo[],
  incoming: SubagentInfo,
): SubagentInfo[] {
  const existingIndex = roster.findIndex((s) => s.id === incoming.id);
  const next = [...roster];
  if (existingIndex === -1) {
    next.push(incoming);
  } else {
    next[existingIndex] = incoming;
  }
  return next.sort(compareSubagents);
}

/**
 * Merge a `get_subagents` snapshot into the roster. The snapshot is the
 * runtime's authoritative registry state, so snapshot fields win over any
 * live-frame fields; subagents absent from the snapshot are dropped.
 */
export function mergeSubagentSnapshot(
  roster: SubagentInfo[],
  snapshot: unknown,
): SubagentInfo[] {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.subagents)) return roster;

  // Index the existing roster by id once so each snapshot entry merges in O(1).
  const byId = new Map<string, SubagentInfo>();
  for (const existing of roster) byId.set(existing.id, existing);

  const merged: SubagentInfo[] = [];
  for (const raw of snapshot.subagents) {
    const info = normalizeSubagent(raw);
    if (!info) continue;
    const existing = byId.get(info.id);
    merged.push(existing ? { ...existing, ...info } : info);
  }

  // Sort once by index/id instead of re-sorting on every upsert.
  return merged.sort(compareSubagents);
}

export function subagentIsActive(info: SubagentInfo): boolean {
  return (
    info.status === "active" ||
    info.status === "running" ||
    info.status === "working" ||
    info.status === "in_progress"
  );
}
