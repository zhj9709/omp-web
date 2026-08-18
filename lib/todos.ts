/**
 * Todo list model for OMP's `todoPhases` state (get_state / set_todos).
 *
 * OMP stores tasks verbatim (no ids): each phase is `{ name, tasks: [] }` and
 * each task is `{ content, status }`. `set_todos` replaces the whole in-memory
 * list, so the UI mutates a local copy and sends it back whole.
 */

export type TodoStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "abandoned"
  | "blocked";

export interface TodoTask {
  content: string;
  status: TodoStatus;
}

export interface TodoPhase {
  name: string;
  tasks: TodoTask[];
}

const VALID_STATUSES: Record<string, true> = {
  pending: true,
  in_progress: true,
  completed: true,
  abandoned: true,
  blocked: true,
};

/** Normalize a wire status string; unknown/legacy values collapse to pending. */
export function normalizeTodoStatus(value: unknown): TodoStatus {
  return typeof value === "string" && VALID_STATUSES[value]
    ? (value as TodoStatus)
    : "pending";
}

/** Sanitize the `todoPhases` payload returned by get_state/set_todos. */
export function normalizeTodoPhases(raw: unknown): TodoPhase[] {
  if (!Array.isArray(raw)) return [];
  const phases: TodoPhase[] = [];
  for (const phaseRaw of raw) {
    if (!phaseRaw || typeof phaseRaw !== "object") continue;
    const phase = phaseRaw as Record<string, unknown>;
    const name = typeof phase.name === "string" ? phase.name : "";
    const tasks: TodoTask[] = [];
    if (Array.isArray(phase.tasks)) {
      for (const taskRaw of phase.tasks) {
        if (!taskRaw || typeof taskRaw !== "object") continue;
        const task = taskRaw as Record<string, unknown>;
        const content = typeof task.content === "string" ? task.content : "";
        if (!content) continue;
        tasks.push({ content, status: normalizeTodoStatus(task.status) });
      }
    }
    phases.push({ name, tasks });
  }
  return phases;
}

export interface TodoCounts {
  total: number;
  done: number;
  inProgress: number;
  blocked: number;
  pending: number;
}

export function countTodos(phases: TodoPhase[]): TodoCounts {
  const counts: TodoCounts = {
    total: 0,
    done: 0,
    inProgress: 0,
    blocked: 0,
    pending: 0,
  };
  for (const phase of phases) {
    for (const task of phase.tasks) {
      counts.total += 1;
      if (task.status === "completed" || task.status === "abandoned") counts.done += 1;
      else if (task.status === "in_progress") counts.inProgress += 1;
      else if (task.status === "blocked") counts.blocked += 1;
      else counts.pending += 1;
    }
  }
  return counts;
}

/** Whether a status counts as "open" (still needs work). */
export function isOpenStatus(status: TodoStatus): boolean {
  return status !== "completed" && status !== "abandoned";
}

export type TodoAction = "start" | "done" | "drop" | "block" | "unblock";

const ACTION_STATUS: Record<TodoAction, TodoStatus> = {
  start: "in_progress",
  done: "completed",
  drop: "abandoned",
  block: "blocked",
  unblock: "pending",
};

/**
 * Return a new phase list with the task at (phaseIndex, taskIndex) transitioned
 * by `action`. The input list is never mutated.
 */
export function applyTodoAction(
  phases: TodoPhase[],
  phaseIndex: number,
  taskIndex: number,
  action: TodoAction,
): TodoPhase[] {
  const nextStatus = ACTION_STATUS[action];
  return phases.map((phase, pi) => {
    if (pi !== phaseIndex) return phase;
    return {
      name: phase.name,
      tasks: phase.tasks.map((task, ti) =>
        ti === taskIndex ? { ...task, status: nextStatus } : task,
      ),
    };
  });
}
