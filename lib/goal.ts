/** Goal-mode types shared by the API route and the chat UI. */

export interface GoalModeInfo {
  id: string;
  objective: string;
  status: string;
  tokensUsed: number;
  timeUsedSeconds: number;
  tokenBudget?: number;
  createdAt: number;
  updatedAt: number;
  /** true when the goal mode is currently enabled (mode "goal"). */
  enabled: boolean;
}

/**
 * Read the latest goal persisted in a session's mode_change entries
 * (OMP appends { mode: "goal"|"goal_paused", data: { goal } } on transitions).
 */
export function extractLatestGoal(
  entries: ReadonlyArray<{ type: string; mode?: string; data?: unknown }>,
): GoalModeInfo | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "mode_change" || !entry.mode?.startsWith("goal")) continue;
    const goal = (entry.data as Record<string, unknown> | undefined)?.goal as Record<string, unknown> | undefined;
    if (!goal || typeof goal.objective !== "string") continue;
    return {
      id: typeof goal.id === "string" ? goal.id : "",
      objective: goal.objective,
      status: typeof goal.status === "string" ? goal.status : "active",
      tokensUsed: typeof goal.tokensUsed === "number" ? goal.tokensUsed : 0,
      timeUsedSeconds: typeof goal.timeUsedSeconds === "number" ? goal.timeUsedSeconds : 0,
      tokenBudget: typeof goal.tokenBudget === "number" ? goal.tokenBudget : undefined,
      createdAt: typeof goal.createdAt === "number" ? goal.createdAt : 0,
      updatedAt: typeof goal.updatedAt === "number" ? goal.updatedAt : 0,
      enabled: entry.mode === "goal",
    };
  }
  return null;
}

/**
 * Normalize a `goal_updated` session event payload (OMP emits
 * { goal, state } frames) into GoalModeInfo, or null when malformed.
 */
export function normalizeGoalEvent(event: {
  goal?: unknown;
  state?: unknown;
}): GoalModeInfo | null {
  const goal = event.goal as Record<string, unknown> | undefined;
  if (!goal || typeof goal.objective !== "string") return null;
  const state = event.state as Record<string, unknown> | undefined;
  return {
    id: typeof goal.id === "string" ? goal.id : "",
    objective: goal.objective,
    status: typeof goal.status === "string" ? goal.status : "active",
    tokensUsed: typeof goal.tokensUsed === "number" ? goal.tokensUsed : 0,
    timeUsedSeconds: typeof goal.timeUsedSeconds === "number" ? goal.timeUsedSeconds : 0,
    tokenBudget: typeof goal.tokenBudget === "number" ? goal.tokenBudget : undefined,
    createdAt: typeof goal.createdAt === "number" ? goal.createdAt : 0,
    updatedAt: typeof goal.updatedAt === "number" ? goal.updatedAt : 0,
    enabled: state?.enabled === true,
  };
}
