"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ProjectMemory, WorkingMemoryEntry } from "@/lib/memory-service";

/* ------------------------------------------------------------------ */
/* Locale text                                                         */
/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/* Shared styles                                                       */
/* ------------------------------------------------------------------ */

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,0.45)",
  backdropFilter: "blur(3px)",
};

const modal: React.CSSProperties = {
  width: 960,
  maxWidth: "94vw",
  height: "min(80vh, 760px)",
  display: "flex",
  flexDirection: "column",
  background: "color-mix(in srgb, var(--bg-floating) 88%, transparent)",
  backdropFilter: "blur(16px) saturate(1.15)",
  WebkitBackdropFilter: "blur(16px) saturate(1.15)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-lg)",
  overflow: "hidden",
  boxShadow: "var(--shadow-modal)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "14px 18px",
  borderBottom: "1px solid var(--border)",
  background: "var(--bg-panel)",
  flexShrink: 0,
};

const searchInputStyle: React.CSSProperties = {
  width: "100%",
  height: 30,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 12.5,
  padding: "0 10px 0 28px",
  outline: "none",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "1px solid var(--border)",
  borderRadius: 8,
  height: 30,
  padding: "0 14px",
  cursor: "pointer",
  color: "var(--text-muted)",
  fontSize: 12.5,
};

const bodyStyle: React.CSSProperties = {
  display: "flex",
  flex: 1,
  minHeight: 0,
};

const sidebarStyle: React.CSSProperties = {
  width: 190,
  flexShrink: 0,
  borderRight: "1px solid var(--border)",
  background: "var(--bg-panel)",
  overflowY: "auto",
  padding: "8px 0",
};

function sidebarBtnStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    textAlign: "left",
    padding: "8px 14px",
    background: active ? "var(--bg-selected)" : "transparent",
    border: "none",
    borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent",
    cursor: "pointer",
    color: active ? "var(--text)" : "var(--text-muted)",
    fontSize: 12.5,
    fontWeight: active ? 600 : 400,
  };
}

const mainStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "8px 18px 24px",
};

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "12px 14px",
  background: "var(--bg-panel)",
  marginBottom: 8,
};

const cardContentStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text)",
  lineHeight: 1.55,
  overflow: "hidden",
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const metaRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginTop: 10,
  fontSize: 11,
  color: "var(--text-muted)",
  flexWrap: "wrap",
};

const sourceBadgeStyle: React.CSSProperties = {
  padding: "2px 8px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  color: "var(--text-dim)",
  fontSize: 10,
  fontWeight: 500,
};

const importanceBarStyle: React.CSSProperties = {
  width: 48,
  height: 4,
  borderRadius: 2,
  background: "var(--border)",
  overflow: "hidden",
  flexShrink: 0,
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function MemoryPanel({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<ProjectMemory[] | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    void fetch("/api/memory", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const gs = (d.groups ?? []) as ProjectMemory[];
        setGroups(gs);
        if (gs.length > 0) setSelectedProject((prev) => prev ?? gs[0].project);
      })
      .catch(() => {
        if (alive) setGroups([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const selectedGroup = useMemo(
    () =>
      groups?.find((g) => g.project === selectedProject) ?? groups?.[0] ?? null,
    [groups, selectedProject],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!selectedGroup) return [];
    if (!q) return selectedGroup.working;
    return selectedGroup.working.filter((w) =>
      w.content.toLowerCase().includes(q),
    );
  }, [selectedGroup, query]);



  return createPortal(
    <div
      style={backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={modal}>
        {/* Header */}
        <div style={headerStyle}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
            {t("memory.title")}
          </div>
          <div style={{ flex: 1, maxWidth: 340, position: "relative" }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("memory.searchPlaceholder")}
              style={searchInputStyle}
            />
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-dim)"
              strokeWidth="2"
              strokeLinecap="round"
              style={{ position: "absolute", left: 10, top: 9 }}
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.5" y2="16.5" />
            </svg>
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} style={closeBtnStyle}>
            ×
          </button>
        </div>

        {/* Body */}
        <div style={bodyStyle}>
          {/* Sidebar — project groups */}
          <div style={sidebarStyle}>
            {groups === null ? (
              <div
                style={{
                  padding: "10px 16px",
                  fontSize: 12,
                  color: "var(--text-dim)",
                  fontStyle: "italic",
                }}
              >
                Loading…
              </div>
            ) : groups.length === 0 ? (
              <div
                style={{
                  padding: "10px 16px",
                  fontSize: 12,
                  color: "var(--text-muted)",
                  fontStyle: "italic",
                }}
              >
                {t("memory.empty")}
              </div>
            ) : (
              groups.map((g) => {
                const active = g.project === selectedProject;
                return (
                  <button
                    key={g.project}
                    type="button"
                    onClick={() => setSelectedProject(g.project)}
                    style={sidebarBtnStyle(active)}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                      }}
                    >
                      {g.project}
                    </span>
                    <span
                      style={{
                        fontSize: 10.5,
                        color: "var(--text-dim)",
                        flexShrink: 0,
                      }}
                    >
                      {g.working.length}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* Main — memory entries */}
          <div style={mainStyle}>
            {!selectedGroup ? (
              <div
                style={{
                  padding: 40,
                  textAlign: "center",
                  color: "var(--text-dim)",
                  fontSize: 13,
                }}
              >
                {t("memory.empty")}
              </div>
            ) : filtered.length === 0 ? (
              <div
                style={{
                  padding: 40,
                  textAlign: "center",
                  color: "var(--text-dim)",
                  fontSize: 13,
                }}
              >
                {query ? t("memory.noMatch") : t("memory.empty")}
              </div>
            ) : (
              filtered.map((entry) => (
                <MemoryCard
                  key={entry.id}
                  entry={entry}
                  recallLabel={t("memory.recall")}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Memory card                                                         */
/* ------------------------------------------------------------------ */

function MemoryCard({
  entry,
  recallLabel,
}: {
  entry: WorkingMemoryEntry;
  recallLabel: string;
}) {
  const importance = Math.max(0, Math.min(1, entry.importance ?? 0));
  const importancePct = Math.round(importance * 100);

  return (
    <div style={cardStyle}>
      <div style={cardContentStyle}>{entry.content}</div>
      <div style={metaRowStyle}>
        {entry.source && (
          <span style={sourceBadgeStyle}>{entry.source}</span>
        )}
        <div style={importanceBarStyle}>
          <div
            style={{
              width: `${importancePct}%`,
              height: "100%",
              borderRadius: 2,
              background: "var(--accent)",
              transition: "width 0.15s",
            }}
          />
        </div>
        <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
          {importancePct}%
        </span>
        <span>
          {entry.recallCount ?? 0}{" "}
          <span style={{ color: "var(--text-dim)" }}>{recallLabel}</span>
        </span>
        {entry.timestamp && (
          <span style={{ color: "var(--text-dim)" }}>
            {new Date(entry.timestamp).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}