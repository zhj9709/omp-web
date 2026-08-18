// Browser-persisted queue-mode defaults for fresh sessions.
//
// Queue modes are session-scoped settings managed by the OMP runtime
// (set_steering_mode / set_follow_up_mode / set_interrupt_mode). This module
// only persists the user's *preference* so a brand-new session starts with the
// last-chosen modes instead of the OMP defaults. Existing sessions read their
// persisted modes back from get_state and are not affected by this preference.

export type SteeringMode = "all" | "one-at-a-time";
export type FollowUpMode = "all" | "one-at-a-time";
export type InterruptMode = "immediate" | "wait";

export interface QueueModes {
  steeringMode: SteeringMode;
  followUpMode: FollowUpMode;
  interruptMode: InterruptMode;
}

export const DEFAULT_QUEUE_MODES: QueueModes = {
  steeringMode: "one-at-a-time",
  followUpMode: "one-at-a-time",
  interruptMode: "immediate",
};

const STORAGE_KEY = "omp-queue-modes";

const STEERING_MODES: Record<string, true> = { all: true, "one-at-a-time": true };
const FOLLOW_UP_MODES: Record<string, true> = { all: true, "one-at-a-time": true };
const INTERRUPT_MODES: Record<string, true> = { immediate: true, wait: true };

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getPreferredQueueModes(
  storage: StorageLike | null = getBrowserStorage(),
): QueueModes {
  if (!storage) return { ...DEFAULT_QUEUE_MODES };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_QUEUE_MODES };
    const parsed = JSON.parse(raw) as Partial<QueueModes>;
    return {
      steeringMode: typeof parsed.steeringMode === "string" && STEERING_MODES[parsed.steeringMode]
        ? parsed.steeringMode
        : DEFAULT_QUEUE_MODES.steeringMode,
      followUpMode: typeof parsed.followUpMode === "string" && FOLLOW_UP_MODES[parsed.followUpMode]
        ? parsed.followUpMode
        : DEFAULT_QUEUE_MODES.followUpMode,
      interruptMode: typeof parsed.interruptMode === "string" && INTERRUPT_MODES[parsed.interruptMode]
        ? parsed.interruptMode
        : DEFAULT_QUEUE_MODES.interruptMode,
    };
  } catch {
    return { ...DEFAULT_QUEUE_MODES };
  }
}

export function setPreferredQueueModes(
  modes: QueueModes,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(modes));
  } catch {
    // Browser storage is best-effort.
  }
}
