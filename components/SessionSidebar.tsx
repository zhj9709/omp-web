"use client";

import { memo, useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { SessionInfo } from "@/lib/types";
import { loadExplorerOpen, saveExplorerOpen } from "@/lib/file-explorer-state";
import { dispatchSessionRowContextMenu } from "@/lib/session-row-context-menu";
import { skillExpansionToCommand } from "@/lib/slash-display";
import { getProjectActivity } from "@/lib/project-groups";
import type { PinnedProject } from "@/lib/pinned-projects";
import { workspaceKeyOf } from "@/lib/workspace-memory";
import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/lib/file-paths";
import { menuPositionFrom, useDismissableMenu } from "@/lib/row-menu";
import { DirectoryPicker } from "./DirectoryPicker";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import styles from "./SessionSidebar.module.css";

declare global {
  interface Window {
    piDesktop?: {
      selectDirectory: () => Promise<string | null>;
    };
  }
}

function ToolbarIconButton({
  onClick,
  title,
  disabled,
  success,
  color,
  background = "transparent",
  marginRight,
  ariaPressed,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  /** Latched "done" state — keeps the success fill instead of the hover fill */
  success?: boolean;
  color: string;
  background?: string;
  marginRight?: number;
  ariaPressed?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={ariaPressed}
      className={success ? `${styles.iconButton} ${styles.iconButtonSuccess}` : styles.iconButton}
      style={{ color, background, marginRight }}
    >
      {children}
    </button>
  );
}

interface Props {
  selectedSessionId: string | null;
  /** The full selected session object, including transient sessions that have
   *  not yet been written to disk. Passed so new sessions can appear in the
   *  sidebar the moment the user sends their first message. */
  selectedSession?: SessionInfo | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  initialSessionId?: string | null;
  skipInitialProjectSelection?: boolean;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  selectedCwd?: string | null;
  onOpenFile?: (filePath: string, fileName: string, options?: { sourceSessionId?: string | null; modeHint?: "diff" }) => void;
  explorerRefreshKey?: number;
  onExplorerRefresh?: () => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
  /** Fired when a session that is not currently selected finishes running.
   *  Lets the app play a cross-workspace completion tone. */
  onBackgroundTaskDone?: () => void;
  onRunningSessionIdsChange?: (ids: Set<string>) => void;
}

const UNREAD_SESSIONS_STORAGE_KEY = "omp-web:unread-session-ids";
const WORKSPACE_VIEW_STORAGE_KEY = "omp-web:workspace-view";
const VIEW_MODE_STORAGE_KEY = "omp-web:sidebar-view-mode";
const RUNNING_SESSIONS_POLL_MS = 2500;

function loadUnreadSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

function saveUnreadSessionIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) window.localStorage.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
    else window.localStorage.setItem(UNREAD_SESSIONS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

// Compact relative-time bucketing (dsh pattern): the bucket is computed here
// so every surface dating a session agrees; the words come from the dictionary.
type RelativeTimeUnit = "now" | "minutes" | "hours" | "days" | "months" | "years";
function relativeTimeBucket(dateStr: string): { unit: RelativeTimeUnit; n: number } {
  const at = new Date(dateStr).getTime();
  const diff = Math.max(0, Date.now() - (Number.isNaN(at) ? 0 : at));
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  if (diff < MIN) return { unit: "now", n: 0 };
  if (diff < HOUR) return { unit: "minutes", n: Math.floor(diff / MIN) };
  if (diff < DAY) return { unit: "hours", n: Math.floor(diff / HOUR) };
  if (diff < 30 * DAY) return { unit: "days", n: Math.floor(diff / DAY) };
  if (diff < 365 * DAY) return { unit: "months", n: Math.floor(diff / (30 * DAY)) };
  return { unit: "years", n: Math.floor(diff / (365 * DAY)) };
}
function timeLabel(dateStr: string, t: (key: string, params?: { n?: number }) => string): string {
  const { unit, n } = relativeTimeBucket(dateStr);
  return t(`sidebar.time.${unit}`, { n });
}

/** Substitute the home dir prefix with ~ (no path truncation — see PathLabel) */
function displayCwd(cwd: string, homeDir?: string): string {
  return (homeDir && cwd.startsWith(homeDir)) ? "~" + cwd.slice(homeDir.length) : cwd;
}

interface SessionTreeNode {
  session: SessionInfo;
  children: SessionTreeNode[];
}

function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
  const byId = new Map<string, SessionTreeNode>();
  for (const s of sessions) {
    byId.set(s.id, { session: s, children: [] });
  }

  // Build a map of parentSessionId chains so we can resolve missing ancestors
  const parentOf = new Map<string, string>();
  for (const s of sessions) {
    if (s.parentSessionId) parentOf.set(s.id, s.parentSessionId);
  }

  // Walk up the parentSessionId chain to find the nearest ancestor that exists in byId
  function resolveAncestor(id: string): string | null {
    let cur = parentOf.get(id);
    const visited = new Set<string>();
    while (cur) {
      if (visited.has(cur)) return null; // cycle guard
      visited.add(cur);
      if (byId.has(cur)) return cur;
      cur = parentOf.get(cur);
    }
    return null;
  }

  const roots: SessionTreeNode[] = [];
  for (const node of byId.values()) {
    const ancestor = resolveAncestor(node.session.id);
    if (ancestor) {
      byId.get(ancestor)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort each level by modified desc
  const sort = (nodes: SessionTreeNode[]) => {
    nodes.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

function useScramble(target: string, running: boolean): string {
  const [display, setDisplay] = useState(target);
  const frameRef = useRef<number | null>(null);
  const iterRef = useRef(0);

  useEffect(() => {
    if (!running) {
      setDisplay(target);
      return;
    }
    iterRef.current = 0;
    const totalFrames = target.length * 4;

    const step = () => {
      iterRef.current += 1;
      const progress = iterRef.current / totalFrames;
      const resolved = Math.floor(progress * target.length);

      setDisplay(
        target
          .split("")
          .map((char, i) => {
            if (char === " ") return " ";
            if (i < resolved) return char;
            return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
          })
          .join("")
      );

      if (iterRef.current < totalFrames) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(target);
      }
    };

    frameRef.current = requestAnimationFrame(step);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [target, running]);

  return display;
}

function OmpWebTitle() {
  const [showVersion, setShowVersion] = useState(false);
  const [scrambling, setScrambling] = useState(false);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const target = showVersion ? `${process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}p${process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}` : "OMP Web";
  const display = useScramble(target, scrambling);

  const triggerScramble = useCallback((toVersion: boolean) => {
    setShowVersion(toVersion);
    setScrambling(true);
    setTimeout(() => setScrambling(false), (toVersion ? 6 : 8) * 4 * (1000 / 60) + 100);
  }, []);

  const handleClick = useCallback(() => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);

    const next = !showVersion;
    triggerScramble(next);

    if (next) {
      revertTimerRef.current = setTimeout(() => triggerScramble(false), 3000);
    }
  }, [showVersion, triggerScramble]);

  useEffect(() => () => { if (revertTimerRef.current) clearTimeout(revertTimerRef.current); }, []);

  return (
    <button
      onClick={handleClick}
      style={{
        background: "none", border: "none", padding: 0, cursor: "default",
        fontWeight: 600, fontSize: 18, letterSpacing: "0.04em",
        color: showVersion ? "var(--accent)" : "var(--alias-label-primary)",
        fontFamily: "var(--font-mono)",
        minWidth: "6ch",
      }}
    >
      {display}
    </button>
  );
}

// Per-group expand state. Two shapes:
//   - { hidden: boolean }          — small groups (≤5 sessions): header toggles visibility
//   - { state: undefined | "five" | "all" } — large groups (>5): cycle collapsed → "five" → "all"
type SmallGroupState = { hidden: boolean };
type LargeGroupState = { state: undefined | "five" | "all" };
type GroupState = SmallGroupState | LargeGroupState;

export const SessionSidebar = memo(function SessionSidebar({ selectedSessionId, selectedSession, onSelectSession, onNewSession, initialSessionId, skipInitialProjectSelection, onInitialRestoreDone, refreshKey, onSessionDeleted, selectedCwd: selectedCwdProp, onOpenFile, explorerRefreshKey, onExplorerRefresh, onAtMention, onAtMentions, onBackgroundTaskDone, onRunningSessionIdsChange }: Props) {
  const { t } = useI18n();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");
  // Pinned projects: server-persisted, survives reloads and crosses browser
  // profiles. They sort to the top of the project tree.
  const [pinnedProjects, setPinnedProjects] = useState<PinnedProject[]>([]);
  const [pinnedLoaded, setPinnedLoaded] = useState(false);
  // Closed projects: hidden from every sidebar view but their session files
  // stay on disk — opening the directory again restores them with history.
  const [closedProjects, setClosedProjects] = useState<Set<string>>(() => new Set());
  // User-arranged project order (drag & drop; newly opened projects go first).
  // Keys missing from the list sort after all listed ones by recent activity.
  const [projectOrder, setProjectOrder] = useState<string[]>([]);
  const [customPathOpen, setCustomPathOpen] = useState(false);
  // Toolbar under the New button (dsh WorkspaceBrowser header): session-title
  // search, group/flat view toggle, and the open-project entry.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"groups" | "flat">(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      return saved === "flat" ? "flat" : "groups";
    } catch { return "groups"; }
  });
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [viewMenuPos, setViewMenuPos] = useState<{ top: number; left: number } | null>(null);
  const viewMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const viewMenuRef = useRef<HTMLDivElement | null>(null);
  const closeViewMenu = useCallback(() => setViewMenuOpen(false), []);
  useDismissableMenu(viewMenuOpen, closeViewMenu, viewMenuRef, viewMenuButtonRef);
  const changeViewMode = useCallback((mode: "groups" | "flat") => {
    setViewMode(mode);
    setViewMenuOpen(false);
    try { window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode); } catch { /* ignore */ }
  }, []);
  const [customPathValue, setCustomPathValue] = useState("");
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [explorerKey, setExplorerKey] = useState(0);
  const [explorerUploadBusy, setExplorerUploadBusy] = useState(false);
  const [changesCount, setChangesCount] = useState(0);
  const [changesCollapsed, setChangesCollapsed] = useState(true);
  const [sessionRefreshDone, setSessionRefreshDone] = useState(false);
  const [explorerRefreshDone, setExplorerRefreshDone] = useState(false);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  // Once polling has delivered a snapshot it is the source of truth for
  // running state; late /api/sessions responses must not overwrite it.
  const runningPollAuthoritativeRef = useRef(false);
  const sessionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const explorerRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileExplorerRef = useRef<FileExplorerHandle>(null);
  const loadSessionsRequestIdRef = useRef(0);
  // Mirror of the selectedSession prop; read inside async loadSessions without
  // making the callback depend on it.
  const selectedSessionRef = useRef<SessionInfo | null>(selectedSession);
  selectedSessionRef.current = selectedSession;
  // Floating scrollbar: the session list's thumb stays transparent until the
  // pointer enters the list, then lingers ~2s after it leaves (no display
  // toggling — scrollbar-gutter keeps layout stable).
  const [scrollbarShown, setScrollbarShown] = useState(false);
  const scrollbarHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showScrollbar = useCallback(() => {
    if (scrollbarHideTimerRef.current) {
      clearTimeout(scrollbarHideTimerRef.current);
      scrollbarHideTimerRef.current = null;
    }
    setScrollbarShown(true);
  }, []);
  const hideScrollbar = useCallback(() => {
    if (scrollbarHideTimerRef.current) clearTimeout(scrollbarHideTimerRef.current);
    scrollbarHideTimerRef.current = setTimeout(() => setScrollbarShown(false), 2000);
  }, []);
  useEffect(() => () => {
    if (scrollbarHideTimerRef.current) clearTimeout(scrollbarHideTimerRef.current);
  }, []);
  // Project group expand state (persisted). Two kinds of groups:
  //   - ≤5 sessions: { hidden: boolean } — header toggles visibility.
  //   - >5 sessions:  { state: undefined | "five" | "all" } — undefined =
  //     collapsed (nothing shown); "five" = first 5 + "expand N more"; "all" =
  //     everything + "collapse". Header cycles collapsed → "five" → "all" → collapsed.
  const [expandState, setExpandState] = useState<Record<string, GroupState>>(() => {
    try {
      const raw = window.localStorage.getItem(WORKSPACE_VIEW_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const result: Record<string, GroupState> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (v === "hidden") result[k] = { hidden: true };
          else if (v === "shown") result[k] = { hidden: false };
          else if (v === "five") result[k] = { state: "five" };
          else if (v === "all") result[k] = { state: "all" };
          else if (v === "collapsed") result[k] = { state: undefined };
        }
        return result;
      }
      return {};
    } catch { return {}; }
  });
  // First-load default: large groups (>5 sessions) start in the "five" state
  // (showing the first 5 + an expand button). Small groups start shown.
  // Runs once after sessions first arrive and only when there is no saved
  // preference yet.
  const didInitDefaultsRef = useRef(false);
  useEffect(() => {
    if (didInitDefaultsRef.current) return;
    if (allSessions.length === 0) return;
    didInitDefaultsRef.current = true;
    const saved = window.localStorage.getItem(WORKSPACE_VIEW_STORAGE_KEY);
    if (saved) return; // user has a preference — honour it
    const groups = new Map<string, number>();
    for (const s of allSessions) {
      const key = workspaceKeyOf(s);
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    const defaults: Record<string, GroupState> = {};
    for (const [key, count] of groups) {
      if (count > 5) defaults[key] = { state: "five" };
    }
    if (Object.keys(defaults).length > 0) setExpandState(defaults);
  }, [allSessions]);

  const loadSessions = useCallback(async (showLoading = false, force = false) => {
    const requestId = ++loadSessionsRequestIdRef.current;
    try {
      if (showLoading) setLoading(true);
      const res = await fetch(force ? "/api/sessions?force=1" : "/api/sessions", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { sessions: SessionInfo[]; runningSessionIds?: string[] };
      if (requestId !== loadSessionsRequestIdRef.current) return;
      setAllSessions(() => {
        // A brand-new session's .jsonl file may not exist yet when a refresh
        // lands (OMP writes it asynchronously). Re-attach the selected
        // transient session whenever the response lacks it — whether or not
        // an earlier optimistic merge already added it — so it cannot vanish
        // mid-run.
        const sel = selectedSessionRef.current;
        if (sel?.transient && !data.sessions.some((s) => s.id === sel.id)) {
          return [...data.sessions, sel];
        }
        return data.sessions;
      });
      // Treat the fetched running set as an initial fallback only. Once the
      // lightweight poll is live, a slow session-list fetch cannot overwrite it.
      if (!runningPollAuthoritativeRef.current) {
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
      }
      // Drop unread markers for sessions that no longer exist (e.g. deleted).
      const existingIds = new Set(data.sessions.map((s) => s.id));
      setUnreadSessionIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set([...prev].filter((id) => existingIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
      setError(null);
      if (!showLoading) {
        setSessionRefreshDone(true);
        if (sessionRefreshTimerRef.current) clearTimeout(sessionRefreshTimerRef.current);
        sessionRefreshTimerRef.current = setTimeout(() => setSessionRefreshDone(false), 2000);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  // A brand-new session may not be on disk yet when the sidebar next polls
  // /api/sessions, so it would be absent from the list until the run ends.
  // Merge the selected session into the list optimistically so it appears the
  // moment the user sends their first message.
  useEffect(() => {
    if (!selectedSession) return;
    setAllSessions((prev) => {
      if (prev.some((s) => s.id === selectedSession.id)) return prev;
      return [...prev, selectedSession];
    });
  }, [selectedSession]);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    loadSessions(isFirst, !isFirst);
  }, [loadSessions, refreshKey]);

  // Load pinned projects from the server once. They are independent of the
  // sessions list, so fetching them separately avoids blocking sidebar render
  // on cold start.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/preferences/pinned-projects", { cache: "no-store" })
      .then(async (r) => (r.ok ? (await r.json()) as { projects: PinnedProject[]; closedProjects?: string[]; projectOrder?: string[] } : null))
      .then((d) => {
        if (cancelled || !d) return;
        setPinnedProjects(Array.isArray(d.projects) ? d.projects : []);
        setClosedProjects(new Set(Array.isArray(d.closedProjects) ? d.closedProjects : []));
        setProjectOrder(Array.isArray(d.projectOrder) ? d.projectOrder : []);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setPinnedLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const pinProject = useCallback(async (key: string, root: string) => {
    let next: PinnedProject[] = [];
    setPinnedProjects((prev) => {
      next = prev.filter((p) => p.key !== key);
      next.push({ key, root, lastOpenedAt: new Date().toISOString() });
      return next;
    });
    try {
      await fetch("/api/preferences/pinned-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pin", key, root }),
      });
    } catch (err) {
      console.error("[omp-web] failed to pin project:", err);
    }
  }, []);

  // Browser storage is unavailable during server rendering. Restore the panel
  // preference after hydration so a collapsed explorer stays collapsed on reload.
  useEffect(() => {
    setExplorerOpen(loadExplorerOpen());
  }, []);

  // Persist unread markers so they survive a browser refresh before the user
  // has actually opened the completed session.
  useEffect(() => {
    saveUnreadSessionIds(unreadSessionIds);
  }, [unreadSessionIds]);

  // Persist expand-state. Small groups store "hidden"/"shown"; large groups
  // store "collapsed"/"five"/"all".
  useEffect(() => {
    try {
      if (Object.keys(expandState).length === 0) {
        window.localStorage.removeItem(WORKSPACE_VIEW_STORAGE_KEY);
        return;
      }
      const serializable: Record<string, string> = {};
      for (const [k, v] of Object.entries(expandState)) {
        if ("hidden" in v) serializable[k] = v.hidden ? "hidden" : "shown";
        else serializable[k] = v.state === "five" ? "five" : v.state === "all" ? "all" : "collapsed";
      }
      window.localStorage.setItem(WORKSPACE_VIEW_STORAGE_KEY, JSON.stringify(serializable));
    } catch { /* ignore storage errors */ }
  }, [expandState]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const schedule = () => {
      clearTimer();
      if (stopped || document.visibilityState !== "visible") return;
      timer = setTimeout(() => void poll(), RUNNING_SESSIONS_POLL_MS);
    };

    const poll = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const current = new AbortController();
      controller?.abort();
      controller = current;
      try {
        const res = await fetch("/api/agent/running", {
          cache: "no-store",
          signal: current.signal,
        });
        if (!res.ok) return;
        const data = await res.json() as { runningSessionIds?: string[] };
        if (stopped || controller !== current) return;
        runningPollAuthoritativeRef.current = true;
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
      } catch {
        // Keep the last known state; the next visible-tab poll retries.
      } finally {
        if (controller === current) controller = null;
        schedule();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void poll();
        return;
      }
      clearTimer();
      controller?.abort();
      controller = null;
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

  useEffect(() => {
    onRunningSessionIdsChange?.(runningSessionIds);
  }, [onRunningSessionIdsChange, runningSessionIds]);

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completedInBackground = [...previous].filter((id) => !runningSessionIds.has(id) && id !== selectedSessionId);
    const newlyRunning = [...runningSessionIds].filter((id) => !previous.has(id));

    if (completedInBackground.length > 0 || newlyRunning.length > 0) {
      setUnreadSessionIds((prev) => {
        const next = new Set(prev);
        runningSessionIds.forEach((id) => next.delete(id));
        completedInBackground.forEach((id) => next.add(id));
        return next;
      });
    }
    const hasUnlistedRunningSession = newlyRunning.some(
      (id) => !allSessions.some((session) => session.id === id),
    );
    if (completedInBackground.length > 0 || hasUnlistedRunningSession) {
      loadSessions(false, true);
    }
    if (completedInBackground.length > 0) {
      onBackgroundTaskDone?.();
    }

    previousRunningSessionIdsRef.current = runningSessionIds;
  }, [runningSessionIds, selectedSessionId, allSessions, loadSessions, onBackgroundTaskDone]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setUnreadSessionIds((prev) => {
      if (!prev.has(selectedSessionId)) return prev;
      const next = new Set(prev);
      next.delete(selectedSessionId);
      return next;
    });
  }, [selectedSessionId]);

  useEffect(() => {
    if (explorerRefreshKey !== undefined) setExplorerKey((k) => k + 1);
  }, [explorerRefreshKey]);

  useEffect(() => {
    fetch("/api/home").then((r) => r.json()).then((d: { home?: string }) => {
      if (d.home) setHomeDir(d.home);
    }).catch(() => {});
  }, []);

  // URL session restore: when the page loads with ?session=<id>, find and
  // select that session. All projects are visible, so no cwd juggling needed.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (allSessions.length === 0 || skipInitialProjectSelection) return;
    if (initialSessionId && !restoredRef.current) {
      restoredRef.current = true;
      const target = allSessions.find((s) => s.id === initialSessionId);
      if (target) {
        onSelectSession(target, true);
        return;
      }
      // Session not found — notify parent so it can show the placeholder
      onInitialRestoreDone?.();
    }
  }, [allSessions, initialSessionId, skipInitialProjectSelection, onSelectSession, onInitialRestoreDone]);

  // Group all sessions by their stable project identity. Pinned projects with
  // no sessions yet (added via the open-project picker) still render as empty
  // groups. Order: user-arranged projectOrder first, then by most recent
  // activity. Within each group, sessions are sorted by modified desc
  // (buildSessionTree handles parent-child forking).
  const projectGroups = useMemo(() => {
    const groups = new Map<string, { key: string; root: string; sessions: SessionInfo[] }>();
    for (const s of allSessions) {
      const key = workspaceKeyOf(s);
      if (closedProjects.has(key)) continue;
      if (!groups.has(key)) {
        groups.set(key, { key, root: s.projectRoot ?? s.cwd, sessions: [] });
      }
      groups.get(key)!.sessions.push(s);
    }
    // Synthesize empty groups for pinned projects that have no sessions (yet).
    for (const p of pinnedProjects) {
      if (closedProjects.has(p.key) || groups.has(p.key)) continue;
      groups.set(p.key, { key: p.key, root: p.root, sessions: [] });
    }
    for (const g of groups.values()) {
      g.sessions.sort((a, b) => b.modified.localeCompare(a.modified));
    }
    const orderIndex = new Map(projectOrder.map((k, i) => [k, i]));
    const pinnedKeys = new Set(pinnedProjects.map((p) => p.key));
    return [...groups.values()].sort((a, b) => {
      const ao = orderIndex.get(a.key);
      const bo = orderIndex.get(b.key);
      if (ao !== undefined || bo !== undefined) {
        // Listed keys keep the user's drag order; unlisted keys follow them.
        if (ao === undefined) return 1;
        if (bo === undefined) return -1;
        return ao - bo;
      }
      const ap = pinnedKeys.has(a.key) ? 0 : 1;
      const bp = pinnedKeys.has(b.key) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      // Both pinned or both unpinned — sort by most recent session
      const aMod = a.sessions[0]?.modified ?? "";
      const bMod = b.sessions[0]?.modified ?? "";
      return bMod.localeCompare(aMod);
    });
  }, [allSessions, pinnedProjects, closedProjects, projectOrder]);

  // All sessions flat, most recent first (flat view + search results share it).
  // Closed projects stay invisible here too.
  const flatSessions = useMemo(
    () => [...allSessions]
      .filter((s) => !closedProjects.has(workspaceKeyOf(s)))
      .sort((a, b) => b.modified.localeCompare(a.modified)),
    [allSessions, closedProjects],
  );
  // Title search mirrors the row title derivation (stored name, else first
  // message with skill blocks collapsed back to /skill commands, else id).
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    return flatSessions.filter((s) => {
      const title = (s.name || (skillExpansionToCommand(s.firstMessage) ?? s.firstMessage).slice(0, 50) || s.id.slice(0, 12)).toLowerCase();
      return title.includes(q);
    });
  }, [searchQuery, flatSessions]);

  // Toggle a project group's expand state. Small groups (≤5) flip hidden ↔
  // shown. Large groups: the header only toggles collapsed ↔ "five"; reaching
  // "all" is reserved for the "expand N more" button.
  const toggleGroup = useCallback((key: string) => {
    const size = projectGroups.find((g) => g.key === key)?.sessions.length ?? 0;
    const isLarge = size > 5;
    setExpandState((prev) => {
      const current = prev[key];
      const next = { ...prev };
      if (isLarge) {
        // Large group: collapsed → "five"; any expanded ("five"/"all") → collapsed.
        const st = current !== undefined && "state" in current ? current.state : undefined;
        if (st === undefined) next[key] = { state: "five" };
        else delete next[key]; // "five" or "all" → collapsed
      } else if (current !== undefined && "hidden" in current) {
        // Small group: flip visibility.
        next[key] = { hidden: !current.hidden };
      } else {
        // Small group, default shown → hide on first click.
        next[key] = { hidden: true };
      }
      return next;
    });
  }, [projectGroups]);

  // Set a large group to a specific expand state (used by the expand/collapse
  // buttons). "none" = collapsed (nothing shown).
  const setGroupState = useCallback((key: string, state: "five" | "all" | "none") => {
    setExpandState((prev) => {
      const next = { ...prev };
      if (state === "none") next[key] = { state: undefined };
      else next[key] = { state };
      return next;
    });
  }, []);

  // Auto-pin the project of the selected session on first hydration of pinned
  // storage, and bump lastOpenedAt on every visit. Visiting a project is the
  // strongest signal the user wants it in their sidebar across browsers.
  useEffect(() => {
    if (!pinnedLoaded || !selectedSession) return;
    const key = workspaceKeyOf(selectedSession);
    const root = selectedSession.projectRoot ?? selectedSession.cwd;
    const already = pinnedProjects.find((p) => p.key === key);
    if (!already || already.root !== root) {
      void pinProject(key, root);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedLoaded, selectedSession?.id, selectedSession?.projectKey, pinProject, pinnedProjects]);

  // Per-project activity counts (running / unread) for the group headers.
  const projectActivity = useMemo(
    () => getProjectActivity(allSessions, runningSessionIds, unreadSessionIds),
    [allSessions, runningSessionIds, unreadSessionIds],
  );

  // Remove a closed key locally and on the server — re-adding a closed
  // project's directory (or reopening it) must survive a page refresh.
  const reopenProject = useCallback((key: string) => {
    setClosedProjects((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    void fetch("/api/preferences/pinned-projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reopen", key }),
    }).catch((err) => console.error("[omp-web] failed to reopen project:", err));
  }, []);

  // Persist a new project order (drag & drop / newly-opened-first).
  const persistProjectOrder = useCallback((next: string[]) => {
    setProjectOrder(next);
    void fetch("/api/preferences/pinned-projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reorder", order: next }),
    }).catch((err) => console.error("[omp-web] failed to save project order:", err));
  }, []);

  // Project drag & drop reordering (grouped view only). HTML5 drag between
  // headers; the insert marker sits on the row half the pointer is over
  // (dsh dropBefore/dropAfter), and the drop inserts there.
  const [draggingProjectKey, setDraggingProjectKey] = useState<string | null>(null);
  const [dragOverProject, setDragOverProject] = useState<{ key: string; half: "before" | "after" } | null>(null);
  const handleProjectDragStart = useCallback((key: string, e: React.DragEvent) => {
    setDraggingProjectKey(key);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", key);
  }, []);
  const handleProjectDragOver = useCallback((key: string, e: React.DragEvent) => {
    if (draggingProjectKey === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const half = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setDragOverProject((prev) => (prev?.key === key && prev.half === half ? prev : { key, half }));
  }, [draggingProjectKey]);
  const handleProjectDrop = useCallback((key: string) => {
    const dragged = draggingProjectKey;
    const over = dragOverProject;
    setDraggingProjectKey(null);
    setDragOverProject(null);
    if (!dragged || dragged === key) return;
    const keys = projectGroups.map((g) => g.key);
    const from = keys.indexOf(dragged);
    if (from === -1 || !keys.includes(key)) return;
    keys.splice(from, 1);
    const half = over?.key === key ? over.half : "before";
    keys.splice(keys.indexOf(key) + (half === "after" ? 1 : 0), 0, dragged);
    // projectOrder also holds keys not currently visible (closed projects);
    // append them so a drag never erases a user-arranged position.
    const visible = new Set(keys);
    persistProjectOrder([...keys, ...projectOrder.filter((k) => !visible.has(k))]);
  }, [draggingProjectKey, dragOverProject, projectGroups, projectOrder, persistProjectOrder]);
  const handleProjectDragEnd = useCallback(() => {
    setDraggingProjectKey(null);
    setDragOverProject(null);
  }, []);

  const commitCustomPath = useCallback(async (candidate?: string) => {
    const path = (candidate ?? customPathValue).trim();
    if (!path || customPathValidating) return;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      const res = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as {
        cwd?: string;
        projectRoot?: string;
        projectKey?: string;
        error?: string;
      };
      if (!res.ok || data.error || !data.cwd) {
        setCustomPathError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setCustomPathOpen(false);
      setCustomPathValue("");
      // Opening a closed project's directory restores it (with its old
      // sessions); the new session below lands in the same tree.
      if (data.projectKey) reopenProject(data.projectKey);
      // Register the project even if it has no sessions yet (it renders as an
      // empty group), and move it to the top of the user's project order.
      const openedKey = data.projectKey ?? data.projectRoot ?? data.cwd;
      void pinProject(openedKey, data.cwd);
      persistProjectOrder([openedKey, ...projectOrder.filter((k) => k !== openedKey)]);
      // Start a new session in the chosen directory — this makes it appear in
      // the project tree and scopes the file explorer to it.
      const tempId = typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      onNewSession?.(tempId, data.cwd);
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathValue, customPathValidating, onNewSession, reopenProject, pinProject, persistProjectOrder, projectOrder]);

  const handleCustomPathClick = useCallback(() => {
    setCustomPathOpen(true);
    setCustomPathError(null);
  }, []);

  const handleSelectSessionFromList = useCallback((s: SessionInfo) => {
    onSelectSession(s);
  }, [onSelectSession]);

  // New session target: the selected session's project, else the first project
  // in the tree. If there are no projects at all, open the directory picker.
  // (Re-choosing the project happens on the new-session page itself, dsh-style.)
  const handleNewSession = useCallback(() => {
    const targetCwd = selectedCwdProp ?? projectGroups[0]?.root ?? null;
    if (!targetCwd) {
      handleCustomPathClick();
      return;
    }
    const tempId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    onNewSession?.(tempId, targetCwd);
  }, [selectedCwdProp, projectGroups, onNewSession, handleCustomPathClick]);

  // New session inside a specific project (the project row's + button).
  const handleNewSessionInProject = useCallback((cwd: string) => {
    const tempId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    onNewSession?.(tempId, cwd);
  }, [onNewSession]);

  // Close a project: hide it from every sidebar view without touching disk.
  // Sessions stay in the .jsonl store; picking the directory again in the
  // open-project picker restores it with its full history.
  const handleCloseProject = useCallback(async (key: string) => {
    setClosedProjects((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    try {
      await fetch("/api/preferences/pinned-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close", key }),
      });
    } catch (err) {
      console.error("[omp-web] failed to close project:", err);
    }
  }, []);

  return (
    <div className={styles.root}>
      {customPathOpen && (
        <DirectoryPicker
          busy={customPathValidating}
          error={customPathError}
          onCancel={() => {
            setCustomPathOpen(false);
            setCustomPathError(null);
          }}
          onSelect={(path) => void commitCustomPath(path)}
        />
      )}
      {/* Logo row */}
      <div className={styles.logoRow}>
        <OmpWebTitle />
        <button
          onClick={() => loadSessions(false, true)}
          className={sessionRefreshDone ? `${styles.iconButton} ${styles.iconButtonSuccess}` : styles.iconButton}
          title={t("sidebar.refresh")}
          aria-label={t("sidebar.refresh")}
        >
          {sessionRefreshDone ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          )}
        </button>
      </div>

      {/* New Session button — starts in the active session's project; the
          project can be re-chose on the new-session page itself. */}
      <button
        onClick={handleNewSession}
        className={styles.newSession}
        title={t("sidebar.new")}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="6" y1="1" x2="6" y2="11" />
          <line x1="1" y1="6" x2="11" y2="6" />
        </svg>
        {t("sidebar.new")}
      </button>

      {/* Toolbar row (dsh WorkspaceBrowser header): title search, view
          options, open project. */}
      <div className={styles.toolbar}>
        {searchOpen ? (
          <div className={styles.searchBox}>
            <input
              autoFocus
              className={styles.searchInput}
              type="text"
              placeholder={t("sidebar.searchSessions")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onBlur={() => {
                // Auto-collapse when abandoned empty; a live query keeps it open.
                if (!searchQuery.trim()) setSearchOpen(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchQuery("");
                  setSearchOpen(false);
                }
              }}
            />
            {searchQuery && (
              <button
                className={styles.searchClear}
                title={t("sidebar.searchSessions")}
                onClick={() => setSearchQuery("")}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
            <button
              className={styles.searchClear}
              title={t("sidebar.searchSessions")}
              onClick={() => { setSearchQuery(""); setSearchOpen(false); }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
          </div>
        ) : (
          <span className={styles.toolbarLabel}>{t("sidebar.workspaces")}</span>
        )}
        <button
          className={styles.iconButton}
          title={t("sidebar.searchSessions")}
          aria-label={t("sidebar.searchSessions")}
          onClick={() => setSearchOpen(true)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
        <button
          ref={viewMenuButtonRef}
          className={styles.iconButton}
          title={t("sidebar.viewOptions")}
          aria-label={t("sidebar.viewOptions")}
          onClick={() => {
            if (viewMenuButtonRef.current) setViewMenuPos(menuPositionFrom(viewMenuButtonRef.current));
            setViewMenuOpen((open) => !open);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="14" y2="12" />
            <line x1="4" y1="18" x2="9" y2="18" />
          </svg>
        </button>
        <button
          className={styles.iconButton}
          title={t("sidebar.openDirectory")}
          aria-label={t("sidebar.openDirectory")}
          onClick={handleCustomPathClick}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <line x1="12" y1="11" x2="12" y2="17" />
            <line x1="9" y1="14" x2="15" y2="14" />
          </svg>
        </button>
      </div>
      {viewMenuOpen && viewMenuPos && createPortal(
        <div
          ref={viewMenuRef}
          role="menu"
          className={styles.sessionMenu}
          style={{ top: viewMenuPos.top, left: viewMenuPos.left }}
        >
          {(["groups", "flat"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="menuitem"
              className={styles.sessionMenuItem}
              onClick={() => changeViewMode(mode)}
            >
              <span className={styles.sessionMenuItemLabel}>
                {mode === "groups" ? t("sidebar.viewGroups") : t("sidebar.viewFlat")}
              </span>
              {viewMode === mode && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>,
        document.body,
      )}

      {/* Session list — all projects visible simultaneously */}
      <div
        className={styles.sessionArea}
        data-scrollbar-shown={scrollbarShown ? "true" : "false"}
        onMouseEnter={showScrollbar}
        onMouseLeave={hideScrollbar}
        style={{ flex: explorerOpen && selectedCwdProp ? "1 1 0" : "1 1 auto" }}
      >
        {loading && (
          <div style={{ padding: "16px 14px", color: "var(--alias-label-secondary)", fontSize: 12 }}>
            {t("sidebar.loading")}
          </div>
        )}
        {error && (
          <div style={{ padding: "12px 14px", color: "var(--error)", fontSize: 12 }}>
            {error}
          </div>
        )}
        {!loading && !error && projectGroups.length === 0 && (
          <div className={styles.emptyState}>
            <p style={{ margin: "0 0 10px", color: "var(--alias-label-secondary)", fontSize: 13, lineHeight: 1.5 }}>
              {t("sidebar.noProjects")}
            </p>
            <button
              onClick={handleCustomPathClick}
              className={styles.newSession}
              style={{ width: "100%" }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="6" y1="1" x2="6" y2="11" />
                <line x1="1" y1="6" x2="11" y2="6" />
              </svg>
              {t("sidebar.openDirectory")}
            </button>
          </div>
        )}
        {searchResults ? (
          searchResults.length === 0 ? (
            <div style={{ padding: "12px 19px", color: "var(--text-dim)", fontSize: 12 }}>
              {t("sidebar.searchNoMatch")}
            </div>
          ) : (
            searchResults.map((s) => (
              <SessionItem
                key={s.id}
                session={s}
                isSelected={s.id === selectedSessionId}
                isRunning={runningSessionIds.has(s.id)}
                isUnread={unreadSessionIds.has(s.id)}
                onClick={() => handleSelectSessionFromList(s)}
                onRenamed={loadSessions}
                onDeleted={(id) => {
                  onSessionDeleted?.(id);
                  loadSessions();
                }}
              />
            ))
          )
        ) : viewMode === "flat" ? (
          flatSessions.map((s) => (
            <SessionItem
              key={s.id}
              session={s}
              isSelected={s.id === selectedSessionId}
              isRunning={runningSessionIds.has(s.id)}
              isUnread={unreadSessionIds.has(s.id)}
              onClick={() => handleSelectSessionFromList(s)}
              onRenamed={loadSessions}
              onDeleted={(id) => {
                onSessionDeleted?.(id);
                loadSessions();
              }}
            />
          ))
        ) : (
        projectGroups.map((group) => (
          <ProjectGroup
            key={group.key}
            group={group}
            state={expandState[group.key]}
            onToggle={() => toggleGroup(group.key)}
            onExpandAll={() => setGroupState(group.key, "all")}
            onCollapse={() => setGroupState(group.key, "five")}
            onNewSessionIn={handleNewSessionInProject}
            onCloseProject={() => void handleCloseProject(group.key)}
            selectedSessionId={selectedSessionId}
            runningSessionIds={runningSessionIds}
            unreadSessionIds={unreadSessionIds}
            activity={projectActivity.get(group.key)}
            onSelectSession={handleSelectSessionFromList}
            onRenamed={loadSessions}
            onSessionDeleted={(id) => {
              onSessionDeleted?.(id);
              loadSessions();
            }}
            homeDir={homeDir}
            draggable={viewMode === "groups" && searchQuery.trim() === ""}
            isDragging={draggingProjectKey === group.key}
            marker={dragOverProject?.key === group.key ? dragOverProject.half : null}
            onDragStart={(e) => handleProjectDragStart(group.key, e)}
            onDragOver={(e) => handleProjectDragOver(group.key, e)}
            onDrop={() => handleProjectDrop(group.key)}
            onDragEnd={handleProjectDragEnd}
          />
        ))
        )}
      </div>

      {/* File Explorer section — scoped to the selected session's project */}
      {selectedCwdProp && (
        <div
          className={explorerOpen ? `${styles.explorerSection} ${styles.explorerSectionOpen}` : styles.explorerSection}
          style={{ flex: explorerOpen ? "1 1 0" : "0 0 auto" }}
        >
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <button
              onClick={() => setExplorerOpen((open) => {
                const next = !open;
                saveExplorerOpen(next);
                return next;
              })}
              className={styles.explorerHeaderButton}
            >
              <svg
                width="9" height="9" viewBox="0 0 10 10" fill="none"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: explorerOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}
              >
                <polyline points="3 2 7 5 3 8" />
              </svg>
              {t("files.explorer")}
            </button>
            {explorerOpen && changesCount > 0 && (
              <ToolbarIconButton
                onClick={() => setChangesCollapsed((v) => !v)}
                title={t("sidebar.changedFiles", { count: changesCount })}
                ariaPressed={!changesCollapsed}
                color={changesCollapsed ? "var(--alias-label-caption)" : "var(--accent)"}
                background={changesCollapsed ? "transparent" : "var(--alias-interactive-bg-hover-accent)"}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M3 12h6" />
                  <path d="M15 12h6" />
                </svg>
              </ToolbarIconButton>
            )}
            {explorerOpen && (
              <ToolbarIconButton
                onClick={() => fileExplorerRef.current?.openUploadPicker()}
                disabled={explorerUploadBusy}
                title={t("sidebar.uploadFilesTitle")}
                color="var(--alias-label-caption)"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <path d="m17 8-5-5-5 5" />
                  <path d="M12 3v12" />
                </svg>
              </ToolbarIconButton>
            )}
            <ToolbarIconButton
              onClick={() => {
                if (onExplorerRefresh) onExplorerRefresh();
                else setExplorerKey((k) => k + 1);
                setExplorerRefreshDone(true);
                if (explorerRefreshTimerRef.current) clearTimeout(explorerRefreshTimerRef.current);
                explorerRefreshTimerRef.current = setTimeout(() => setExplorerRefreshDone(false), 2000);
              }}
              title={t("sidebar.refreshExplorer")}
              success={explorerRefreshDone}
              color="var(--alias-label-caption)"
              background="transparent"
              marginRight={6}
            >
              {explorerRefreshDone ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              )}
            </ToolbarIconButton>
          </div>
          {explorerOpen && (
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", minHeight: 0 }}>
              <FileExplorer
                ref={fileExplorerRef}
                cwd={selectedCwdProp}
                onOpenFile={onOpenFile ?? (() => {})}
                refreshKey={explorerKey}
                onAtMention={onAtMention}
                onAtMentions={onAtMentions}
                onUploadBusyChange={setExplorerUploadBusy}
                changesCollapsed={changesCollapsed}
                onChangesCountChange={setChangesCount}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
});

/**
 * A single project group in the sidebar tree. Two behaviours:
 *   - ≤5 sessions: header toggles show/hide. No expand/collapse buttons.
 *   - >5 sessions: header toggles collapsed ↔ "five" (first 5 + an "expand N
 *     more" button). "all" (everything + a "collapse" button) is reached only
 *     via the "expand N more" button; the "collapse" button returns to collapsed.
 */
function ProjectGroup({
  group,
  state,
  onToggle,
  onExpandAll,
  onCollapse,
  onNewSessionIn,
  onCloseProject,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  activity,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  homeDir,
  draggable,
  isDragging,
  marker,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  group: { key: string; root: string; sessions: SessionInfo[] };
  state: GroupState | undefined;
  onToggle: () => void;
  onExpandAll: () => void;
  onCollapse: () => void;
  /** Start a new session inside this project. */
  onNewSessionIn: (cwd: string) => void;
  /** Close the project: hide it from the sidebar; sessions stay on disk. */
  onCloseProject: () => void;
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  activity: { running: number; unread: number } | undefined;
  onSelectSession: (s: SessionInfo) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
  homeDir: string;
  /** Drag & drop reordering (grouped view without an active search only). */
  draggable?: boolean;
  isDragging?: boolean;
  /** Insert-marker position while a drag hovers this row (dsh dropBefore/After). */
  marker?: "before" | "after" | null;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
}) {
  const { t } = useI18n();
  const tree = useMemo(() => buildSessionTree(group.sessions), [group.sessions]);
  const isLarge = group.sessions.length > 5;
  // Project row "..." menu (workspace actions, e.g. delete workspace), in the
  // same portalled style as the session row menu.
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDismissableMenu(menuOpen, closeMenu, menuRef, menuButtonRef);
  const openMenu = useCallback(() => {
    if (menuButtonRef.current) setMenuPos(menuPositionFrom(menuButtonRef.current));
    setMenuOpen(true);
  }, []);

  // Resolve visible state. Small groups: hidden boolean. Large groups: cycle.
  const isHidden = !isLarge ? (state !== undefined && "hidden" in state && state.hidden) : false;
  const largeState = isLarge ? (state !== undefined && "state" in state ? state.state : undefined) : undefined;
  const isCollapsed = isLarge && largeState === undefined;
  const visibleRoots = !isLarge ? (isHidden ? [] : tree)
    : isCollapsed ? []
    : largeState === "all" ? tree
    : tree.slice(0, 5);
  const hiddenCount = isLarge && largeState === "five" ? Math.max(0, tree.length - 5) : 0;

  return (
    <div className={styles.projectGroup}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); }
        }}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={(e) => { e.preventDefault(); onDrop?.(); }}
        onDragEnd={onDragEnd}
        className={[
          styles.projectHeader,
          menuOpen ? styles.projectHeaderMenuOpen : "",
          isDragging ? styles.projectHeaderDragging : "",
          marker === "before" ? styles.projectHeaderDropBefore : "",
          marker === "after" ? styles.projectHeaderDropAfter : "",
        ].filter(Boolean).join(" ")}
        title={displayCwd(group.root, homeDir)}
        aria-label={t("sidebar.projectHeader", { name: getFileName(group.root), count: group.sessions.length })}
        aria-expanded={isLarge ? !isCollapsed : !isHidden}
      >
        <svg
          width="9" height="9" viewBox="0 0 10 10" fill="none"
          stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          className={styles.projectHeaderChevron}
          style={{ transform: (isLarge ? isCollapsed : isHidden) ? "none" : "rotate(90deg)", flexShrink: 0 }}
        >
          <polyline points="3 2 7 5 3 8" />
        </svg>
        <span className={styles.projectName}>{getFileName(group.root)}</span>
        <span className={styles.projectCount}>{group.sessions.length}</span>
        {showProjectActivity(activity, t)}
        {/* Row actions surface on hover (dsh ProjectRowItem): new session
            plus button, then the workspace "..." menu. */}
        <span className={styles.projectRowActions}>
          <button
            type="button"
            title={t("sidebar.new")}
            aria-label={t("sidebar.new")}
            className={styles.rowMenuButton}
            onClick={(e) => { e.stopPropagation(); onNewSessionIn(group.root); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            ref={menuButtonRef}
            type="button"
            title={t("sidebar.projectActions")}
            aria-label={t("sidebar.projectActions")}
            className={styles.rowMenuButton}
            onClick={(e) => { e.stopPropagation(); if (menuOpen) setMenuOpen(false); else openMenu(); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="1.7" />
              <circle cx="12" cy="12" r="1.7" />
              <circle cx="19" cy="12" r="1.7" />
            </svg>
          </button>
        </span>
      </div>
      {menuOpen && menuPos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className={styles.sessionMenu}
          style={{ top: menuPos.top, left: menuPos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className={`${styles.sessionMenuItem} ${styles.sessionMenuItemDanger}`}
            onClick={() => { setMenuOpen(false); onCloseProject(); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            {t("sidebar.closeProject")}
          </button>
        </div>,
        document.body,
      )}
      {visibleRoots.map((node) => (
        <SessionTreeItem
          key={node.session.id}
          node={node}
          selectedSessionId={selectedSessionId}
          runningSessionIds={runningSessionIds}
          unreadSessionIds={unreadSessionIds}
          onSelectSession={onSelectSession}
          onRenamed={onRenamed}
          onSessionDeleted={onSessionDeleted}
          depth={0}
        />
      ))}
      {/* Expand / collapse buttons only for large groups. */}
      {isLarge && largeState === "five" && hiddenCount > 0 && (
        <button
          onClick={onExpandAll}
          className={styles.expandMore}
          aria-label={t("sidebar.expandMore", { count: hiddenCount })}
        >
          {t("sidebar.expandMore", { count: hiddenCount })}
        </button>
      )}
      {isLarge && largeState === "all" && (
        <button
          onClick={onCollapse}
          className={styles.expandMore}
          aria-label={t("sidebar.collapse")}
        >
          {t("sidebar.collapse")}
        </button>
      )}
    </div>
  );
}

function SessionTreeItem({
  node,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  depth,
}: {
  node: SessionTreeNode;
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  onSelectSession: (s: SessionInfo) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div style={{ position: "relative" }}>
        {/* Indent line for child sessions */}
        {depth > 0 && (
          <div style={{
            position: "absolute",
            left: depth * 12 + 6,
            top: 0, bottom: 0,
            width: 1,
            background: "var(--alias-border-l3)",
            pointerEvents: "none",
          }} />
        )}
        <SessionItem
          session={node.session}
          isSelected={node.session.id === selectedSessionId}
          isRunning={runningSessionIds.has(node.session.id)}
          isUnread={unreadSessionIds.has(node.session.id)}
          onClick={() => onSelectSession(node.session)}
          onRenamed={onRenamed}
          onDeleted={(id) => onSessionDeleted?.(id)}
          depth={depth}
          hasChildren={hasChildren}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
        />
      </div>
      {hasChildren && !collapsed && (
        <div>
          {node.children.map((child) => (
            <SessionTreeItem
              key={child.session.id}
              node={child}
              selectedSessionId={selectedSessionId}
              runningSessionIds={runningSessionIds}
              unreadSessionIds={unreadSessionIds}
              onSelectSession={onSelectSession}
              onRenamed={onRenamed}
              onSessionDeleted={onSessionDeleted}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RunningSessionIndicator() {
  const { t } = useI18n();
  return (
    <span
      title={t("sidebar.agentRunning")}
      aria-label={t("sidebar.agentRunning")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <g>
          <path
            d="M21 12a9 9 0 1 1-3.8-7.4"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 12 12"
            to="360 12 12"
            dur="0.9s"
            repeatCount="indefinite"
          />
        </g>
      </svg>
    </span>
  );
}

function UnreadSessionIndicator() {
  const { t } = useI18n();
  return (
    <span
      title={t("sidebar.newActivity")}
      aria-label={t("sidebar.newSessionActivity")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--info)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <circle cx="7" cy="7" r="2.5" fill="currentColor" />
        <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" opacity="0.32">
          <animate attributeName="r" values="3;6;3" dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.32;0;0.32" dur="1.6s" repeatCount="indefinite" />
        </circle>
      </svg>
    </span>
  );
}

/**
 * Compact per-project activity badges for the group header: a spinning running
 * icon + count and an unread dot + count. Renders nothing when the project has
 * no activity. Counts share the accent / unread colors of the per-session
 * indicators so the two stay visually consistent.
 */
function showProjectActivity(
  activity: { running: number; unread: number } | undefined,
  t: (key: string) => string,
): ReactNode {
  if (!activity || (activity.running === 0 && activity.unread === 0)) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, marginLeft: 6 }}>
      {activity.running > 0 && (
        <span
          title={t("sidebar.agentRunning")}
          aria-label={`${t("sidebar.agentRunning")} (${activity.running})`}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--accent)", fontSize: 10, fontFamily: "var(--font-mono)" }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
            <g>
              <path d="M21 12a9 9 0 1 1-3.8-7.4" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
              <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
            </g>
          </svg>
          {activity.running}
        </span>
      )}
      {activity.unread > 0 && (
        <span
          title={t("sidebar.newSessionActivity")}
          aria-label={`${t("sidebar.newSessionActivity")} (${activity.unread})`}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--info)", fontSize: 10, fontFamily: "var(--font-mono)" }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
          {activity.unread}
        </span>
      )}
    </span>
  );
}

function SessionItem({
  session,
  isSelected,
  isRunning,
  isUnread,
  onClick,
  onRenamed,
  onDeleted,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
}: {
  session: SessionInfo;
  isSelected: boolean;
  isRunning?: boolean;
  isUnread?: boolean;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Row "..." menu (secondary menu): rename and delete live in there.
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDismissableMenu(menuOpen, closeMenu, menuRef, menuButtonRef);

  // Select the whole name once the rename input is mounted (startRename's
  // immediate setTimeout can fire before the input exists).
  useEffect(() => {
    if (renaming) {
      const id = requestAnimationFrame(() => inputRef.current?.select());
      return () => cancelAnimationFrame(id);
    }
  }, [renaming]);

  // A stored first message may be an SDK-expanded <skill> block; collapse it
  // back to the compact /skill:name args command the user typed before using
  // it as the auto-name fallback, mirroring MessageView's rendering.
  const displayFirstMessage = skillExpansionToCommand(session.firstMessage) ?? session.firstMessage;
  const title = session.name || displayFirstMessage.slice(0, 50) || session.id.slice(0, 12);

  const startRename = useCallback(() => {
    if (session.transient) return;
    setRenameValue(session.name || displayFirstMessage.slice(0, 50) || session.id.slice(0, 12));
    setRenaming(true);
  }, [session.name, session.transient, displayFirstMessage, session.id]);

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    // No-op when unchanged: the fallback title (first message / id) isn't a
    // real stored name, so don't persist it as one. (The rename input seeds
    // from the same collapsed displayFirstMessage, so an untouched rename of
    // a skill-invoked session stays a no-op instead of persisting raw XML.)
    if (renameValue === title || name === (session.name ?? "")) {
      setRenaming(false);
      return;
    }
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        setRenaming(true);
        return;
      }
      setRenaming(false);
      onRenamed?.();
    } catch {
      setRenaming(false);
    }
  }, [renameValue, session.id, session.name, onRenamed, title]);

  const performDelete = useCallback(async () => {
    if (session.transient) return;
    setConfirmDelete(false);
    setDeleting(true);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      if (!res.ok) {
        setDeleting(false);
        return;
      }
      onDeleted?.(session.id);
    } catch {
      setDeleting(false);
    }
  }, [session.id, session.transient, onDeleted]);

  // Open the row's secondary menu anchored under the "..." button.
  const openMenu = useCallback(() => {
    if (menuButtonRef.current) setMenuPos(menuPositionFrom(menuButtonRef.current));
    setMenuOpen(true);
  }, []);

  const handleDeleteConfirm = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    void performDelete();
  }, [performDelete]);

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const handled = dispatchSessionRowContextMenu({
      id: session.id,
      path: session.path,
      cwd: session.cwd,
      name: session.name,
      clientX: e.clientX,
      clientY: e.clientY,
      refresh: () => { onRenamed?.(); },
    });
    if (!handled) return;
    e.preventDefault();
    e.stopPropagation();
  }, [onRenamed, session.cwd, session.id, session.name, session.path]);

  // Fixed-height outer wrapper — content swaps in place so the list never reflows
  return (
    <div
      onClick={confirmDelete || renaming ? undefined : onClick}
      onContextMenu={confirmDelete || renaming ? undefined : handleContextMenu}
      className={[
        styles.sessionRow,
        isSelected ? styles.sessionRowSelected : "",
        confirmDelete ? styles.sessionRowConfirm : "",
        menuOpen ? styles.sessionRowMenuOpen : "",
      ].filter(Boolean).join(" ")}
      style={{
        paddingLeft: depth > 0 ? depth * 12 + 19 : 19,
        cursor: confirmDelete || renaming ? "default" : "pointer",
        opacity: deleting ? 0.5 : 1,
      }}
    >
      {confirmDelete ? (
        /* ── Delete confirmation: same height, two flat buttons ── */
        <>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--alias-label-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("sidebar.deleteSession", { title: title.slice(0, 22) + (title.length > 22 ? "…" : "") })}
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button
              onClick={handleDeleteConfirm}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                height: 24, padding: "0 9px",
                background: "var(--error)", border: "none",
                borderRadius: 6, color: "#fff",
                cursor: "pointer", fontSize: 12, fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              {t("sidebar.delete")}
            </button>
            <button
              onClick={handleDeleteCancel}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: 24, padding: "0 9px",
                background: "transparent", border: "0.5px solid var(--alias-border-l3)",
                borderRadius: 6, color: "var(--alias-label-secondary)",
                cursor: "pointer", fontSize: 12, fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              {t("sidebar.cancel")}
            </button>
          </div>
        </>
      ) : renaming ? (
        /* ── Rename: input fills the same row ── */
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          autoFocus
          style={{
            flex: 1,
            fontSize: 12,
            padding: "2px 8px",
            border: "1px solid var(--accent)",
            borderRadius: 6,
            outline: "none",
            background: "var(--alias-button-floating-fill)",
            color: "var(--alias-label-primary)",
            height: 24,
          }}
        />
      ) : (
        /* ── Normal view: single-line dsh cell — status slot, title, time,
           trailing "..." menu that swaps in for the time on hover ── */
        <>
          {/* Leading status slot: running / unread markers (occupies width
              only when present, so idle titles start closer to the edge) */}
          {(isRunning || isUnread) && (
            <span className={styles.sessionSlot}>
              {isRunning ? <RunningSessionIndicator /> : <UnreadSessionIndicator />}
            </span>
          )}
          {/* Fork indicator for child sessions */}
          {depth > 0 && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--alias-label-caption)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          )}
          <span
            className={isSelected ? `${styles.sessionTitle} ${styles.sessionTitleSelected}` : styles.sessionTitle}
            title={session.worktreeBranch ? `${title} · ${session.worktreeBranch}` : title}
          >
            {title}
          </span>

          {/* Collapse toggle — always visible when has children */}
          {hasChildren && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
              title={t(collapsed ? "sidebar.collapseForks" : "sidebar.expandForks")}
              className={styles.chevronButton}
              style={{ transform: collapsed ? "rotate(-90deg)" : "none" }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            </button>
          )}

          {/* Trailing time; a blank provisional row (transient) has neither a
              timestamp nor row verbs — nothing has happened in it yet. */}
          {!session.transient && <span className={styles.sessionTime}>{timeLabel(session.modified, t)}</span>}

          {/* "..." opens the row's secondary menu (rename / delete) */}
          {!session.transient && (
            <span className={styles.rowMenu}>
              <button
                ref={menuButtonRef}
                type="button"
                aria-label={t("sidebar.sessionActions")}
                title={t("sidebar.sessionActions")}
                className={styles.rowMenuButton}
                onClick={(e) => { e.stopPropagation(); if (menuOpen) setMenuOpen(false); else openMenu(); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="5" cy="12" r="1.7" />
                  <circle cx="12" cy="12" r="1.7" />
                  <circle cx="19" cy="12" r="1.7" />
                </svg>
              </button>
            </span>
          )}
        </>
      )}
      {menuOpen && menuPos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className={styles.sessionMenu}
          style={{ top: menuPos.top, left: menuPos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className={styles.sessionMenuItem}
            onClick={() => { setMenuOpen(false); startRename(); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
            {t("sidebar.rename")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${styles.sessionMenuItem} ${styles.sessionMenuItemDanger}`}
            onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            {t("sidebar.delete")}
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
