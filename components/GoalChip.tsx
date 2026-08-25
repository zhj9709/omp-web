"use client";

import { memo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { formatDuration } from "@/lib/session-timing";
import type { GoalModeInfo } from "@/lib/goal";

const GOAL_STATUS: Record<string, { color: string; labelKey: string }> = {
  active: { color: "var(--accent)", labelKey: "goal.active" },
  paused: { color: "var(--warning)", labelKey: "goal.paused" },
  complete: { color: "var(--success)", labelKey: "goal.complete" },
  dropped: { color: "var(--text-muted)", labelKey: "goal.dropped" },
  "budget-limited": { color: "var(--warning)", labelKey: "goal.budgetLimited" },
};

/** Read-only goal-mode chip: objective + status + usage, expandable details. */
export const GoalChip = memo(function GoalChip({ goal }: { goal: GoalModeInfo }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const status = GOAL_STATUS[goal.status] ?? { color: "var(--text-muted)", labelKey: goal.status };
  const hasBudget = typeof goal.tokenBudget === "number";

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--bg-panel)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-label={t("goal.title")}
        title={t("goal.title")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          height: 34,
          padding: "0 12px",
          border: "none",
          background: "none",
          cursor: "pointer",
          fontSize: 12.5,
          color: "var(--text)",
          textAlign: "left",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: status.color, flexShrink: 0 }} aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </svg>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {goal.objective}
        </span>
        <span
          style={{
            flexShrink: 0,
            fontSize: 11,
            fontWeight: 600,
            color: status.color,
          }}
        >
          {t(status.labelKey)}
        </span>
        <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
          {goal.tokensUsed.toLocaleString()} tok · {formatDuration(goal.timeUsedSeconds * 1000)}
        </span>
        <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-muted)" }}>
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && (
        <div style={{ padding: "8px 12px 10px", borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
          <div>{t("goal.objective")}: {goal.objective}</div>
          <div>
            {t("goal.tokensUsed", { count: goal.tokensUsed.toLocaleString() })}
            {hasBudget ? ` · ${t("goal.tokenBudget", { count: goal.tokenBudget!.toLocaleString() })}` : ""}
          </div>
          <div>{t("goal.timeUsed", { time: formatDuration(goal.timeUsedSeconds * 1000) })}</div>
        </div>
      )}
    </div>
  );
});
