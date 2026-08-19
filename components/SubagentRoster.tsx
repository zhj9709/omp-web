"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  subagentIsActive,
  type SubagentInfo,
  type SubagentTranscript,
  type SubagentTranscriptMessage,
} from "@/lib/subagents";

const STATUS_COLORS: Record<string, string> = {
  active: "var(--accent)",
  running: "var(--accent)",
  working: "var(--accent)",
  in_progress: "var(--accent)",
  completed: "#22c55e",
  done: "#22c55e",
  succeeded: "#22c55e",
  failed: "#ef4444",
  error: "#ef4444",
  aborted: "#f59e0b",
  parked: "var(--text-muted)",
  idle: "var(--text-muted)",
  unknown: "var(--text-muted)",
};

function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? STATUS_COLORS.unknown;
}

function transcriptText(message: SubagentTranscriptMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object") {
          const b = block as Record<string, unknown>;
          if (typeof b.text === "string") return b.text;
          if (typeof b.content === "string") return b.content;
          if (b.type === "toolCall" || b.type === "tool_use") {
            const name = typeof b.name === "string" ? b.name : "";
            return `[tool] ${name}`;
          }
          if (typeof b.type === "string") return `[${b.type}]`;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    return JSON.stringify(content);
  }
  return "";
}

function TranscriptView({
  transcript,
  onClose,
}: {
  transcript: SubagentTranscript;
  onClose: () => void;
}) {
  const messages = transcript.messages ?? [];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          Subagent transcript
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to subagent list"
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 12,
            padding: "2px 6px",
          }}
        >
          Back
        </button>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {messages.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
            No transcript available.
          </div>
        ) : (
          messages.map((message, i) => {
            const text = transcriptText(message);
            const isUser = message.role === "user";
            const isAssistant = message.role === "assistant";
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: isUser ? "flex-end" : "flex-start",
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    color: "var(--text-dim)",
                    marginBottom: 2,
                    padding: "0 4px",
                  }}
                >
                  {message.role || "message"}
                </span>
                <div
                  style={{
                    maxWidth: "92%",
                    padding: "6px 10px",
                    borderRadius: 8,
                    background: isUser
                      ? "var(--user-bg)"
                      : isAssistant
                        ? "var(--assistant-bg)"
                        : "var(--bg-subtle)",
                    color: "var(--text)",
                    fontSize: 12,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {text || "[empty]"}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export const SubagentRoster = memo(function SubagentRoster({
  subagents,
  unavailable = false,
  onRefresh,
  loadTranscript,
}: {
  subagents: SubagentInfo[];
  unavailable?: boolean;
  onRefresh: () => void;
  loadTranscript: (subagentId: string) => Promise<SubagentTranscript | null>;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<SubagentTranscript | null>(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const activeCount = subagents.filter(subagentIsActive).length;

  const close = useCallback(() => {
    setOpen(false);
    setSelectedId(null);
    setTranscript(null);
    setLoadingTranscript(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Auto-hide when the user clicks outside the toggle button or the panel.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, close]);

  useEffect(() => {
    if (!open || selectedId === null) return;
    let cancelled = false;
    setLoadingTranscript(true);
    setTranscript(null);
    loadTranscript(selectedId)
      .then((result) => {
        if (!cancelled) setTranscript(result);
      })
      .finally(() => {
        if (!cancelled) setLoadingTranscript(false);
      });
    return () => {
      cancelled = true;
      setLoadingTranscript(false);
    };
  }, [open, selectedId, loadTranscript]);

  const showTranscript = selectedId !== null;

  return (
    <>
      {(open || subagents.length > 0) && (
      <button
        aria-label="子代理"
        title={unavailable ? "子代理不可用" : "子代理"}
        className="toolbar-ghost-btn"
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          zIndex: 45,
          display: "flex",
          alignItems: "center",
          gap: 6,
          borderRadius: 6,
          padding: "5px 10px",
          fontSize: 12,
          cursor: "pointer",
          background: open ? "var(--bg-hover)" : undefined,
          color: open ? "var(--text)" : undefined,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="7" width="14" height="12" rx="2" />
          <path d="M12 7V4" /><circle cx="12" cy="3" r="1" />
          <line x1="9" y1="12" x2="9" y2="12.01" /><line x1="15" y1="12" x2="15" y2="12.01" />
        </svg>
        <span>子代理</span>
        {activeCount > 0 && (
          <span
            style={{
              background: "var(--accent)",
              color: "var(--bg)",
              borderRadius: 999,
              minWidth: 18,
              height: 18,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 700,
              padding: "0 4px",
            }}
          >
            {activeCount}
          </span>
        )}
      </button>
      )}

      {open && (
        <div
          ref={panelRef}
          style={{
            position: "absolute",
            top: 48,
            left: 12,
            zIndex: 45,
            width: 360,
            maxWidth: "calc(100vw - 24px)",
            maxHeight: "min(480px, calc(100vh - 96px))",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {showTranscript ? (
            <TranscriptView
              transcript={transcript ?? { subagentId: selectedId, sessionFile: null, fromByte: 0, nextByte: 0, reset: false, entries: [], messages: [] }}
              onClose={() => {
                setSelectedId(null);
                setTranscript(null);
                setLoadingTranscript(false);
              }}
            />
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--border)",
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                  子代理
                </span>
                <button
                  type="button"
                  onClick={onRefresh}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 11,
                    padding: "2px 6px",
                  }}
                >
                  刷新
                </button>
              </div>
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                  padding: 6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {loadingTranscript && (
                  <div style={{ color: "var(--text-muted)", fontSize: 12, padding: "8px 10px" }}>
                    加载中…
                  </div>
                )}
                {subagents.length === 0 ? (
                  <div style={{ color: "var(--text-muted)", fontSize: 12, padding: "8px 10px" }}>
                    {unavailable
                      ? "子代理监控不可用。"
                      : "暂无子代理。task 工具启动的子代理会显示在这里。"}
                  </div>
                ) : (
                  subagents.map((info) => (
                    <button
                      key={info.id}
                      type="button"
                      onClick={() => setSelectedId(info.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        textAlign: "left",
                        background: "none",
                        border: "none",
                        borderRadius: 8,
                        padding: "8px 10px",
                        cursor: "pointer",
                        color: "var(--text)",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-hover)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = "none";
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: statusColor(info.status),
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                        <span
                          style={{
                            fontSize: 12,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {info.label}
                        </span>
                        {info.agentType && (
                          <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
                            {info.agentType}
                          </span>
                        )}
                        {info.progress?.text && (
                          <span
                            style={{
                              fontSize: 10,
                              color: "var(--text-muted)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {info.progress.text}
                          </span>
                        )}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: statusColor(info.status),
                          flexShrink: 0,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {info.status}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
});
