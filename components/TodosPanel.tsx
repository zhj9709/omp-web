"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
  applyTodoAction,
  countTodos,
  isOpenStatus,
  type TodoAction,
  type TodoPhase,
  type TodoStatus,
} from "@/lib/todos";

interface TaskButton {
  action: TodoAction;
  label: string;
}

function taskButtons(status: TodoStatus): TaskButton[] {
  switch (status) {
    case "pending":
      return [
        { action: "start", label: "Start" },
        { action: "block", label: "Block" },
        { action: "done", label: "Done" },
        { action: "drop", label: "Drop" },
      ];
    case "in_progress":
      return [
        { action: "done", label: "Done" },
        { action: "block", label: "Block" },
        { action: "drop", label: "Drop" },
      ];
    case "blocked":
      return [
        { action: "unblock", label: "Unblock" },
        { action: "start", label: "Start" },
        { action: "drop", label: "Drop" },
      ];
    case "completed":
      return [
        { action: "unblock", label: "Reopen" },
        { action: "drop", label: "Drop" },
      ];
    case "abandoned":
      return [
        { action: "unblock", label: "Reopen" },
        { action: "done", label: "Done" },
      ];
  }
}

function statusDot(status: TodoStatus): string {
  switch (status) {
    case "completed":
      return "var(--accent)";
    case "in_progress":
      return "#f59e0b";
    case "blocked":
      return "#ef4444";
    case "abandoned":
      return "var(--text-dim)";
    default:
      return "var(--border)";
  }
}

function statusLabel(status: TodoStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "in_progress":
      return "In progress";
    case "completed":
      return "Done";
    case "abandoned":
      return "Dropped";
    case "blocked":
      return "Blocked";
  }
}

interface TodosPanelProps {
  phases: TodoPhase[];
  onChange: (phases: TodoPhase[]) => void | Promise<void>;
  onClose?: () => void;
}

export const TodosPanel = memo(function TodosPanel({ phases, onChange, onClose }: TodosPanelProps) {
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [collapsedPhases, setCollapsedPhases] = useState<Set<number>>(new Set());
  const [newTask, setNewTask] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const counts = countTodos(phases);
  const percent = counts.total === 0
    ? 0
    : Math.round((counts.done / counts.total) * 100);

  const commit = (next: TodoPhase[]) => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    Promise.resolve(onChange(next))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  const submitNewTask = () => {
    if (submitting) return;
    const content = newTask.trim();
    if (!content) return;
    const next = phases.length === 0
      ? [{ name: "Todos", tasks: [{ content, status: "pending" as const }] }]
      : phases.map((phase, i) => (
        i === 0
          ? { name: phase.name, tasks: [...phase.tasks, { content, status: "pending" as const }] }
          : phase
      ));
    setNewTask("");
    commit(next);
  };

  const apply = (phaseIndex: number, taskIndex: number, action: TodoAction) => {
    commit(applyTodoAction(phases, phaseIndex, taskIndex, action));
  };

  const togglePhase = (index: number) => {
    setCollapsedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Auto-hide the panel once every task is complete.
  useEffect(() => {
    if (counts.total > 0 && counts.done === counts.total) {
      onCloseRef.current?.();
    }
  }, [counts.total, counts.done]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        maxHeight: "30%",
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--bg-panel)",
        overflow: "hidden",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          borderBottom: collapsed ? "none" : "1px solid var(--border)",
        }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand todos" : "Collapse todos"}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 12,
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <span style={{ fontWeight: 600, fontSize: 12, color: "var(--text)" }}>
          Todos
        </span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", flex: 1 }}>
          {counts.done}/{counts.total} done
          {counts.blocked > 0 ? ` · ${counts.blocked} blocked` : ""}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close todos"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 14,
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            ✕
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          {error && (
            <div
              role="alert"
              style={{
                margin: "0 8px 8px",
                padding: "7px 10px",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 6,
                background: "rgba(239,68,68,0.07)",
                color: "#ef4444",
                fontSize: 12,
                lineHeight: 1.4,
                whiteSpace: "pre-wrap",
              }}
            >
              {error}
            </div>
          )}
          {counts.total > 0 && (
            <div style={{ padding: "2px 10px 4px" }}>
              <div
                style={{
                  height: 3,
                  borderRadius: 2,
                  background: "var(--bg-hover)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${percent}%`,
                    background: "var(--accent)",
                    transition: "width 0.2s ease",
                  }}
                />
              </div>
            </div>
          )}

          <div
            style={{
              overflowY: "auto",
              padding: "0 6px 6px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {phases.length === 0 && (
              <div
                style={{
                  padding: "16px 8px",
                  textAlign: "center",
                  color: "var(--text-muted)",
                  fontSize: 13,
                }}
              >
                No todos yet. Add a task below.
              </div>
            )}

            {phases.map((phase, phaseIndex) => {
              const phaseDone = phase.tasks.filter(
                (task) => !isOpenStatus(task.status),
              ).length;
              const isCollapsed = collapsedPhases.has(phaseIndex);
              return (
                <div
                  key={`${phase.name}-${phaseIndex}`}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}
                >
                  <button
                    type="button"
                    onClick={() => togglePhase(phaseIndex)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "7px 10px",
                      background: "var(--bg-subtle)",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                      {isCollapsed ? "▸" : "▾"}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
                      {phase.name || `Phase ${phaseIndex + 1}`}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
                      {phaseDone}/{phase.tasks.length}
                    </span>
                  </button>

                  {!isCollapsed && (
                    <div style={{ padding: "4px 6px" }}>
                      {phase.tasks.length === 0 && (
                        <div style={{ padding: "8px 10px", color: "var(--text-muted)", fontSize: 12 }}>
                          No tasks in this phase.
                        </div>
                      )}
                      {phase.tasks.map((task, taskIndex) => (
                        <div
                          key={`${task.content}-${taskIndex}`}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 8,
                            padding: "6px 6px",
                            borderRadius: 6,
                          }}
                        >
                          <span
                            style={{
                              flexShrink: 0,
                              width: 10,
                              height: 10,
                              borderRadius: "50%",
                              marginTop: 4,
                              background: statusDot(task.status),
                            }}
                          />
                          <span
                            style={{
                              flex: 1,
                              fontSize: 13,
                              lineHeight: 1.35,
                              color: "var(--text)",
                              textDecoration: isOpenStatus(task.status) ? "none" : "line-through",
                              opacity: isOpenStatus(task.status) ? 1 : 0.55,
                              wordBreak: "break-word",
                            }}
                          >
                            {task.content}
                          </span>
                          <span style={{ flexShrink: 0, fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
                            {statusLabel(task.status)}
                          </span>
                          <span
                            style={{
                              flexShrink: 0,
                              display: "flex",
                              gap: 4,
                              marginTop: -1,
                            }}
                          >
                            {taskButtons(task.status).map((button) => (
                              <button
                                key={button.action}
                                type="button"
                                disabled={submitting}
                                onClick={() => apply(phaseIndex, taskIndex, button.action)}
                                style={{
                                  background: "var(--bg-hover)",
                                  border: "1px solid var(--border)",
                                  borderRadius: 5,
                                  padding: "1px 7px",
                                  fontSize: 11,
                                  color: "var(--text)",
                                  cursor: submitting ? "default" : "pointer",
                                  opacity: submitting ? 0.5 : 1,
                                }}
                              >
                                {button.label}
                              </button>
                            ))}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div
            style={{
              display: "flex",
              gap: 4,
              padding: "6px 10px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <input
              type="text"
              value={newTask}
              onChange={(event) => setNewTask(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitNewTask();
              }}
              placeholder="Add a task…"
              style={{
                flex: 1,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "6px 9px",
                fontSize: 13,
                color: "var(--text)",
              }}
            />
            <button
              type="button"
              onClick={submitNewTask}
              disabled={!newTask.trim() || submitting}
              style={{
                background: "var(--accent)",
                color: "#ffffff",
                border: "none",
                borderRadius: 6,
                padding: "6px 12px",
                fontSize: 13,
                cursor: newTask.trim() && !submitting ? "pointer" : "default",
                opacity: newTask.trim() && !submitting ? 1 : 0.5,
              }}
            >
              Add
            </button>
          </div>
        </>
      )}
    </div>
  );
});
