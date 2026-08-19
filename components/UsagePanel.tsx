"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { UsageStats } from "@/lib/usage-stats";


function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function formatCost(n: number): string {
  if (n === 0) return "$0";
  if (n >= 10) return "$" + n.toFixed(2);
  if (n >= 1) return "$" + n.toFixed(3);
  if (n >= 0.01) return "$" + n.toFixed(4);
  return "$" + n.toFixed(6);
}

function formatDayLabel(day: string): string {
  // "2025-08-15" -> "8/15"
  const parts = day.split("-");
  return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
}

interface Props {
  onClose: () => void;
}

export const UsagePanel = memo(function UsagePanel({ onClose }: Props) {
  const { t } = useI18n();

  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/usage")
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((data: UsageStats) => {
        if (!cancelled) {
          setStats(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCloseRef.current();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") onCloseRef.current();
  }, []);

  const dialogRef = useRef<HTMLDivElement>(null);

  // Auto-focus dialog so Escape works
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // --- bar chart: normalize heights ---
  const maxTokens = stats ? Math.max(1, ...stats.byDay.map((d) => d.tokens)) : 1;

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0,0,0,0.4)",
      }}
      onClick={handleBackdrop}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t("usage.title")}
        onKeyDown={handleKeyDown}
        style={{
          width: 640,
          maxWidth: "100%",
          maxHeight: "calc(100vh - 32px)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          background: "var(--bg-panel)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 18px 12px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
            {t("usage.title")}
          </h2>
          <button
            onClick={onClose}
            aria-label={t("usage.close")}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              padding: "4px 6px",
              borderRadius: "var(--radius-xs)",
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ overflow: "auto", padding: "16px 18px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)", fontSize: 13 }}>
              {t("usage.loading")}
            </div>
          ) : error ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--error)", fontSize: 13 }}>
              {t("usage.error")}
            </div>
          ) : !stats || stats.totals.requests === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)", fontSize: 13 }}>
              {t("usage.empty")}
            </div>
          ) : (
            <>
              {/* Chips */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
                <Chip label={t("usage.tokens")} value={formatTokens(stats.totals.tokens)} />
                <Chip label={t("usage.cost")} value={formatCost(stats.totals.cost)} />
                <Chip label={t("usage.requests")} value={String(stats.totals.requests)} />
                <Chip label={t("usage.sessions")} value={String(stats.totals.sessions)} />
              </div>

              {/* 30-day bar chart */}
              <SectionHeading>{t("usage.last30Days")}</SectionHeading>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 2,
                  height: 120,
                  padding: "4px 0 6px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                {stats.byDay.map((d) => {
                  const heightPct = (d.tokens / maxTokens) * 100;
                  const barColor =
                    d.tokens > 0
                      ? "var(--accent)"
                      : "var(--text-dim)";
                  return (
                    <div
                      key={d.day}
                      title={`${d.day}: ${formatTokens(d.tokens)} tokens, ${formatCost(d.cost)}, ${d.requests} ${t("usage.requests")}`}
                      style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "flex-end",
                        alignItems: "center",
                        height: "100%",
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          width: "100%",
                          height: `${Math.max(heightPct, d.tokens > 0 ? 2 : 0)}%`,
                          background: barColor,
                          borderRadius: "var(--radius-xs) var(--radius-xs) 0 0",
                          opacity: d.tokens > 0 ? 0.85 : 0.25,
                          transition: "opacity 0.15s",
                          cursor: "default",
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.opacity = "1";
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.opacity = d.tokens > 0 ? "0.85" : "0.25";
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              {/* X-axis labels: show every 5th day */}
              <div style={{ display: "flex", gap: 2, marginTop: 4, marginBottom: 20 }}>
                {stats.byDay.map((d, i) => (
                  <div
                    key={d.day}
                    style={{
                      flex: 1,
                      fontSize: 9,
                      color: "var(--text-dim)",
                      textAlign: "center",
                      fontVariantNumeric: "tabular-nums",
                      visibility: i % 5 === 0 ? "visible" : "hidden",
                      minWidth: 0,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatDayLabel(d.day)}
                  </div>
                ))}
              </div>

              {/* Model list */}
              {stats.byModel.length > 0 && (
                <>
                  <SectionHeading>{t("usage.model")}</SectionHeading>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {stats.byModel.map((m) => {
                      const maxCost = stats.byModel[0].cost || 1;
                      const barPct = (m.cost / maxCost) * 100;
                      const modelLabel = m.model === "unknown" ? t("usage.unknownModel") : m.model;
                      return (
                        <div key={m.model} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                            <span
                              style={{
                                fontSize: 12,
                                color: "var(--text)",
                                fontFamily: "var(--font-mono)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                flex: 1,
                                minWidth: 0,
                              }}
                            >
                              {modelLabel}
                            </span>
                            <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                              {formatTokens(m.tokens)} · {formatCost(m.cost)}
                            </span>
                          </div>
                          <div
                            style={{
                              height: 4,
                              borderRadius: "var(--radius-xs)",
                              background: "var(--bg-hover)",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                width: `${barPct}%`,
                                background: "var(--accent)",
                                borderRadius: "var(--radius-xs)",
                                opacity: 0.6,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

// ── Sub-components ────────────────────────────────────────────────────────

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "8px 14px",
        borderRadius: "var(--radius-md)",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        minWidth: 80,
      }}
    >
      <span style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </span>
      <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
        {value}
      </span>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: "var(--text-dim)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        marginBottom: 8,
        marginTop: 4,
      }}
    >
      {children}
    </div>
  );
}