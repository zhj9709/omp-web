"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SessionInfo } from "@/lib/types";

const POLL_MS = 2500;

const LOCALE_TEXT = {
  en: {
    runningCenter: "Running Tasks",
    noRunning: "No running tasks",
    refresh: "Refresh",
    totalRunning: "Total running: {count}",
    justNow: "just now",
    minutesAgo: "{n}m ago",
    hoursAgo: "{n}h ago",
    daysAgo: "{n}d ago",
  },
  "zh-CN": {
    runningCenter: "运行中任务",
    noRunning: "无运行中任务",
    refresh: "刷新",
    totalRunning: "共 {count} 个运行中",
    justNow: "刚刚",
    minutesAgo: "{n} 分钟前",
    hoursAgo: "{n} 小时前",
    daysAgo: "{n} 天前",
  },
} as const;

interface RunningSession {
  id: string;
  title: string;
  cwd: string;
  created: string;
}

export interface RunningCenterProps {
  onOpenSession: (id: string) => void;
}

function formatRelativeTime(dateStr: string, locale: "en" | "zh-CN"): string {
  const t = LOCALE_TEXT[locale];
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return t.justNow;
  if (mins < 60) return t.minutesAgo.replace("{n}", String(mins));
  if (hours < 24) return t.hoursAgo.replace("{n}", String(hours));
  if (days < 7) return t.daysAgo.replace("{n}", String(days));
  return date.toLocaleDateString();
}

export function RunningCenter({ onOpenSession }: RunningCenterProps) {
  const { locale } = useI18n();
  const t = LOCALE_TEXT[locale] ?? LOCALE_TEXT.en;

  const [open, setOpen] = useState(false);
  const [runningSessions, setRunningSessions] = useState<RunningSession[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pollRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // Polling: 2.5s interval, visibility-gated, abort-on-hide
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;

    const clearTimer = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      clearTimer();
      if (stopped || document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => void poll(), POLL_MS);
    };

    const poll = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const current = new AbortController();
      controller?.abort();
      controller = current;
      try {
        const runningRes = await fetch("/api/agent/running", {
          cache: "no-store",
          signal: current.signal,
        });
        if (!runningRes.ok) return;
        const runningData = await runningRes.json() as { runningSessionIds?: string[] };
        const runningIds = runningData.runningSessionIds ?? [];

        if (stopped || controller !== current) return;

        if (runningIds.length === 0) {
          setRunningSessions([]);
          return;
        }

        const sessionsRes = await fetch("/api/sessions", {
          cache: "no-store",
          signal: current.signal,
        });
        if (!sessionsRes.ok) return;
        const sessionsData = await sessionsRes.json() as { sessions?: SessionInfo[] };
        const allSessions = sessionsData.sessions ?? [];

        if (stopped || controller !== current) return;

        const runningSet = new Set(runningIds);
        const running: RunningSession[] = allSessions
          .filter((s) => runningSet.has(s.id))
          .map((s) => ({
            id: s.id,
            title: s.name || s.firstMessage || s.id,
            cwd: s.cwd,
            created: s.created,
          }));

        setRunningSessions(running);
      } catch {
        // Keep last known state; next visible-tab poll retries.
      } finally {
        if (controller === current) controller = undefined;
        schedule();
      }
    };

    pollRef.current = poll;

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void poll();
        return;
      }
      clearTimer();
      controller?.abort();
      controller = undefined;
    };

    void poll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  const handleSessionClick = useCallback(
    (id: string) => {
      onOpenSession(id);
      setOpen(false);
    },
    [onOpenSession],
  );

  const count = runningSessions.length;
  const hasRunning = count > 0;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        ref={buttonRef}
        onClick={() => setOpen((prev) => !prev)}
        title={t.runningCenter}
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-1)",
          padding: "var(--space-1) var(--space-2)",
          border: "none",
          background: "transparent",
          color: "var(--text)",
          cursor: "pointer",
          borderRadius: "var(--radius-sm)",
          opacity: hasRunning ? 1 : 0.5,
          fontSize: "13px",
          lineHeight: "1",
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: hasRunning ? "var(--accent)" : "var(--border)",
            animation: hasRunning ? "pulse 1.2s ease-in-out infinite" : "none",
          }}
        />
        {hasRunning && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 18,
              height: 18,
              padding: "0 5px",
              borderRadius: "var(--radius-xs)",
              background: "var(--accent)",
              color: "#fff",
              fontSize: "11px",
              fontWeight: 600,
              lineHeight: "1",
            }}
          >
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: "var(--space-2)",
            minWidth: 280,
            maxWidth: 360,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-menu)",
            zIndex: 1000,
            overflow: "hidden",
          }}
        >
          {hasRunning ? (
            <>
              <div style={{ maxHeight: 320, overflowY: "auto" }}>
                {runningSessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleSessionClick(s.id)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "var(--space-2) var(--space-3)",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      color: "var(--text)",
                      fontSize: "13px",
                      lineHeight: "1.4",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "var(--bg-hover)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "transparent";
                    }}
                  >
                    <div
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontWeight: 500,
                      }}
                    >
                      {s.title}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-1)",
                        marginTop: "var(--space-1)",
                        fontSize: "11px",
                        color: "var(--text-muted)",
                      }}
                    >
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: 160,
                        }}
                      >
                        {s.cwd}
                      </span>
                      <span style={{ flexShrink: 0 }}>
                        {formatRelativeTime(s.created, locale)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "var(--space-2) var(--space-3)",
                  borderTop: "1px solid var(--border)",
                  fontSize: "12px",
                  color: "var(--text-muted)",
                }}
              >
                <span>
                  {t.totalRunning.replace("{count}", String(count))}
                </span>
                <button
                  onClick={() => void pollRef.current()}
                  title={t.refresh}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                    padding: "var(--space-1) var(--space-2)",
                    border: "none",
                    background: "transparent",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "12px",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.color =
                      "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.color =
                      "var(--text-muted)";
                  }}
                >
                  {t.refresh}
                </button>
              </div>
            </>
          ) : (
            <div
              style={{
                padding: "var(--space-4) var(--space-3)",
                textAlign: "center",
                color: "var(--text-muted)",
                fontSize: "13px",
              }}
            >
              {t.noRunning}
            </div>
          )}
        </div>
      )}
    </div>
  );
}