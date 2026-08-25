"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import type { SessionInfo } from "@/lib/types";
import type { FileIndexEntry } from "@/lib/file-fuzzy";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface CommandPaletteAction {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Injected actions (new session, switch theme, open panels, etc.) */
  actions: CommandPaletteAction[];
  /** Called when the user selects a session in the palette. */
  onOpenSession: (id: string) => void;
  /**
   * Called when the user selects a file from the file-search results.
   * Both regular files and directories are included; directories are
   * marked with a folder icon.
   */
  onOpenFile?: (path: string) => void;
  /**
   * Absolute project directory used to search files via /api/file-index.
   * The files group is only enabled when both `cwd` and `onOpenFile` are
   * provided.  Pass the active project cwd from AppShell.
   */
  cwd?: string | null;
}

/* ------------------------------------------------------------------ */
/* Internal item type (flat list for keyboard navigation)              */
/* ------------------------------------------------------------------ */

interface PaletteItem {
  key: string;
  group: "actions" | "sessions" | "files";
  label: string;
  hint?: string;
  isDir?: boolean;
  run: () => void;
}

/* ------------------------------------------------------------------ */
/* Locale text                                                         */
/* ------------------------------------------------------------------ */


const GROUP_ORDER = ["actions", "sessions", "files"] as const;

/* ------------------------------------------------------------------ */
/* Fuzzy scoring helpers                                               */
/* ------------------------------------------------------------------ */

/** Subsequence match with consecutive-run and word-boundary bonuses.
 *  Returns the score or null when the query is not a subsequence. */
function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let qi = 0;
  let last = -2;
  let score = 0;
  let run = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t.charCodeAt(i) !== q.charCodeAt(qi)) continue;
    const consecutive = i === last + 1;
    run = consecutive ? run + 1 : 1;
    score += 1 + (consecutive ? run : 0);
    if (i === 0) {
      score += 4;
    } else {
      const prev = t[i - 1];
      if (prev === " " || prev === "/" || prev === "-" || prev === "_" || prev === "." || prev === ":") {
        score += 2;
      }
    }
    last = i;
    qi++;
  }
  return qi === q.length ? score : null;
}

function rank<T>(items: readonly T[], getText: (item: T) => string, query: string, limit: number): T[] {
  const q = query.trim();
  if (!q) return items.slice(0, limit);
  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const s = fuzzyScore(q, getText(item));
    if (s !== null) scored.push({ item, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item);
}

function sessionTitle(s: SessionInfo): string {
  return s.name?.trim() || s.firstMessage?.trim()?.slice(0, 80) || s.id?.slice(0, 12) || "";
}

/* ------------------------------------------------------------------ */
/* Icons (inline SVG, stroke=currentColor)                             */
/* ------------------------------------------------------------------ */

function SearchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  );
}

function ActionIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function SessionIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function FileIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="13 2 13 9 20 9" />
    </svg>
  );
}

function FolderIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function CommandPalette(props: CommandPaletteProps) {
  const { open, onClose, actions, onOpenSession, onOpenFile, cwd } = props;

  const { t } = useI18n();

  /* ---- state ---- */
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [files, setFiles] = useState<FileIndexEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const fileEnabled = Boolean(cwd && onOpenFile);

  /* ---- refs for keyboard handler (avoids re-registering on every keystroke) ---- */
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<PaletteItem[]>([]);
  const activeIndexRef = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  /* ---- sessions: fetch once on open ---- */
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setSessions([]);
    fetch("/api/sessions", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { sessions?: SessionInfo[] }) => {
        if (alive) setSessions(d.sessions ?? []);
      })
      .catch(() => {
        /* silent degrade */
      });
    return () => { alive = false; };
  }, [open]);

  /* ---- files: debounced fetch per query ---- */
  useEffect(() => {
    const q = query.trim();
    if (!open || !fileEnabled || !q || !cwd) {
      setFiles([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      fetch(`/api/file-index?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d: { matches?: FileIndexEntry[] }) => {
          if (alive) setFiles(d.matches ?? []);
        })
        .catch(() => {
          if (alive) setFiles([]);
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, fileEnabled, cwd, query]);

  /* ---- build flat items list ---- */
  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim();
    const actionItems: PaletteItem[] = rank(actions, (a) => `${a.label} ${a.hint ?? ""}`, q, 6).map((a) => ({
      key: `action:${a.id}`,
      group: "actions" as const,
      label: a.label,
      hint: a.hint,
      run: a.run,
    }));
    const sessionItems: PaletteItem[] = rank(sessions, sessionTitle, q, 6).map((s) => ({
      key: `session:${s.id}`,
      group: "sessions" as const,
      label: sessionTitle(s),
      hint: s.cwd?.replace(/[/\\]+$/, "").split(/[/\\]/).filter(Boolean).pop() ?? "",
      run: () => onOpenSession(s.id),
    }));
    const fileItems: PaletteItem[] = fileEnabled && q
      ? files.slice(0, 6).map((f) => ({
          key: `file:${f.path}`,
          group: "files" as const,
          label: f.path,
          hint: f.isDir ? t("palette.directory") : undefined,
          isDir: f.isDir,
          run: () => onOpenFile?.(f.path),
        }))
      : [];
    return [...actionItems, ...sessionItems, ...fileItems];
  }, [actions, sessions, files, query, fileEnabled, onOpenSession, onOpenFile, t]);

  /* ---- keep refs in sync ---- */
  itemsRef.current = items;
  activeIndexRef.current = activeIndex;
  useEffect(() => {
    if (activeIndex >= items.length) setActiveIndex(Math.max(0, items.length - 1));
  }, [items.length, activeIndex]);

  /* ---- keyboard: global capture listener (↑↓↵Esc) ---- */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      const its = itemsRef.current;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (its.length === 0) return;
        setActiveIndex((prev) => (prev + 1) % its.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (its.length === 0) return;
        setActiveIndex((prev) => (prev - 1 + its.length) % its.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = its[activeIndexRef.current];
        if (item) {
          item.run();
          onCloseRef.current();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  /* ---- reset state on open ---- */
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setFiles([]);
      const raf = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
  }, [open]);
  /* ---- scroll active item into view ---- */
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  /* ---- execute item & close ---- */
  const execute = useCallback((item: PaletteItem) => {
    item.run();
    onClose();
  }, [onClose]);

  /* ---- group helpers ---- */
  const groups = useMemo(() => {
    const acc: Record<PaletteItem["group"], PaletteItem[]> = { actions: [], sessions: [], files: [] };
    for (const item of items) acc[item.group].push(item);
    return GROUP_ORDER.filter((g) => acc[g].length > 0).map((g) => ({ group: g, items: acc[g] }));
  }, [items]);

  if (!open) return null;

  /* ---- render ---- */
  return createPortal(
    /* Backdrop: transparent so Raycast-style, click to close */
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Panel */}
      <div
        style={{
          margin: "18vh auto 0",
          width: 560,
          maxWidth: "92vw",
          maxHeight: "min(60vh, 540px)",
          display: "flex",
          flexDirection: "column",
          background: "color-mix(in srgb, var(--bg-floating) 88%, transparent)",
          backdropFilter: "blur(16px) saturate(1.15)",
          WebkitBackdropFilter: "blur(16px) saturate(1.15)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
        }}
        onMouseDown={(e) => {
          /* prevent backdrop click from closing when clicking inside panel */
          e.stopPropagation();
        }}
      >
        {/* Input */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 14px",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <SearchIcon />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder={t("palette.placeholder")}
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              boxShadow: "none",
              background: "transparent",
              color: "var(--text)",
              fontSize: 14,
              fontFamily: "inherit",
            }}
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        {/* Results */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "6px 0",
          }}
        >
          {groups.length === 0 ? (
            <div
              style={{
                padding: "32px 16px",
                textAlign: "center",
                color: "var(--text-dim)",
                fontSize: 13,
              }}
            >
              {t("palette.noResults")}
            </div>
          ) : (
            groups.map((g, gi) => {
              const groupLabel: string = t(`palette.${g.group}`) ?? g.group;
              return (
                <div key={g.group}>
                  {gi > 0 && (
                    <div
                      style={{
                        margin: "4px 12px",
                        borderTop: "1px solid var(--border)",
                      }}
                    />
                  )}
                  <div
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "var(--text-dim)",
                      padding: "2px 14px 4px",
                    }}
                  >
                    {groupLabel}
                  </div>
                  {g.items.map((item) => {
                    const idx = items.indexOf(item);
                    const isActive = idx === activeIndex;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        ref={(el) => {
                          itemRefs.current[idx] = el;
                        }}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onMouseDown={(e) => {
                          /* prevent input blur before click fires */
                          e.preventDefault();
                        }}
                        onClick={() => execute(item)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          width: "100%",
                          textAlign: "left",
                          padding: "7px 14px",
                          border: "none",
                          background: isActive ? "var(--bg-selected)" : "transparent",
                          cursor: "pointer",
                          fontSize: 13,
                          color: "var(--text)",
                          outline: "none",
                          fontFamily: "inherit",
                        }}
                      >
                        {/* Icon */}
                        <span style={{ flexShrink: 0, display: "flex", color: "var(--text-dim)" }}>
                          {item.group === "actions" && <ActionIcon />}
                          {item.group === "sessions" && <SessionIcon />}
                          {item.group === "files" && (item.isDir ? <FolderIcon /> : <FileIcon />)}
                        </span>
                        {/* Label */}
                        <span
                          style={{
                            flex: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {item.label}
                        </span>
                        {/* Hint */}
                        {item.hint && (
                          <span
                            style={{
                              flexShrink: 0,
                              fontSize: 11,
                              color: "var(--text-dim)",
                            }}
                          >
                            {item.hint}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}