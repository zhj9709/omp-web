"use client";

import { useEffect, useRef, useState } from "react";

/**
 * One step of the typewriter reveal. Returns the next displayed text, or
 * `null` when the display is already caught up with `raw`.
 *
 * - `raw` extending `display` (the normal streaming case) advances the display
 *   by `step` characters this frame.
 * - `raw` no longer starting with `display` means the text was rewritten
 *   mid-stream (rare) — re-anchor to the new text immediately.
 */
export function nextTypewriterText(display: string, raw: string, step: number): string | null {
  if (raw === display) return null;
  if (raw.startsWith(display)) {
    const gap = raw.length - display.length;
    return raw.slice(0, display.length + Math.min(Math.max(1, step), gap));
  }
  return raw;
}

/**
 * Smoothing delay: the display deliberately trails the raw stream by this
 * much so that upstream bursts can be spread evenly across it. Measured
 * upstream waves: 100-400 chars per wave, gaps between waves 60-400ms,
 * occasionally longer thinking pauses. 600ms covers the common gaps with
 * margin; when the buffer runs dry the pacer holds a gentle minimum rate
 * instead of stalling, so long gaps read as a slow trickle, not a stop.
 */
const BUFFER_DELAY_MS = 600;

/**
 * Smooth typewriter display for streaming text, paced like a jitter buffer.
 *
 * The upstream emits text in bursts (waves of 100-400 chars separated by
 * 60-400ms pauses). Rendering each wave as fast as it arrives reads as
 * chunked bursts-and-stalls no matter how the drain step is tuned: fast
 * drain = sprint then idle; slow drain = lag then a visible catch-up lump.
 *
 * Instead the display intentionally trails the raw stream by BUFFER_DELAY_MS
 * and reveals at a rate that keeps that lag constant:
 *
 * - Each frame computes the target display length: everything that arrived
 *   more than BUFFER_DELAY_MS ago (plus a catch-up share of what arrived
 *   within the window, so the buffer empties gently at stream end instead
 *   of dumping a tail).
 * - The actual reveal moves toward that target at a rate-limited pace
 *   (EMA of recent target growth + a fraction of the remaining gap), so a
 *   single huge wave still reads as acceleration, never as a dump.
 * - When no text arrived recently the pace decays smoothly toward a gentle
 *   minimum, so a dry buffer trails off like the model thinking — not a
 *   hard stop.
 * - Mount-time content shows immediately (it is history); only deltas after
 *   mount are paced. Rewritten text re-anchors instantly.
 */
export function useTypewriterText(rawText: string, active: boolean): string {
  const [displayText, setDisplayText] = useState(rawText);
  const rawRef = useRef(rawText);
  const displayRef = useRef(rawText);
  const rafRef = useRef<number | null>(null);
  // Per-frame reveal pace (chars/frame), rate-limited toward the target.
  const paceRef = useRef(0);
  // Timeline of arrivals: [{ t, total }] sampled per effect run (per React
  // commit that changed rawText). Used to compute how much of the stream is
  // "older than" the smoothing delay.
  const arrivalsRef = useRef<{ t: number; total: number }[]>([]);
  const lastTotalRef = useRef(rawText.length);
  const streamEndAtRef = useRef<number | null>(null);
  rawRef.current = rawText;

  useEffect(() => {
    if (!active) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (displayRef.current !== rawText) {
        displayRef.current = rawText;
        setDisplayText(rawText);
      }
      return;
    }

    streamEndAtRef.current = null;
    const now = performance.now();
    if (rawText.length !== lastTotalRef.current) {
      arrivalsRef.current.push({ t: now, total: rawText.length });
      lastTotalRef.current = rawText.length;
      // Bound the timeline: only the recent window matters for pacing.
      const cutoff = now - BUFFER_DELAY_MS * 3;
      const arrivals = arrivalsRef.current;
      let keep = 0;
      while (keep < arrivals.length - 1 && arrivals[keep].t < cutoff) keep++;
      if (keep > 0) arrivalsRef.current = arrivals.slice(keep);
    }

    const tick = () => {
      rafRef.current = null;
      const raw = rawRef.current;
      const display = displayRef.current;
      const t = performance.now();

      // Target: what should be visible now.
      // 1) Everything that arrived before (now - BUFFER_DELAY_MS): fully due.
      // 2) A catch-up share of the recent window so the buffer does not hold
      //    a full 300ms of text hostage until the stream ends.
      const arrivals = arrivalsRef.current;
      let target = display.length;
      if (arrivals.length > 0) {
        const due = now - BUFFER_DELAY_MS;
        // Walk from newest to oldest: find the newest arrival older than due.
        let dueTotal = arrivals[0].total;
        for (let i = arrivals.length - 1; i >= 0; i--) {
          if (arrivals[i].t <= due) { dueTotal = arrivals[i].total; break; }
        }
        const newestTotal = arrivals[arrivals.length - 1].total;
        target = dueTotal + (newestTotal - dueTotal) * 0.35;
      }
      // Stream ended (raw stopped growing): drain whatever remains at the
      // current pace rather than freezing a 300ms tail.
      if (raw.length === lastTotalRef.current && streamEndAtRef.current === null) {
        // No new arrival this frame; only mark end after a quiet period.
        const lastArrival = arrivals[arrivals.length - 1];
        if (lastArrival && t - lastArrival.t > BUFFER_DELAY_MS) {
          streamEndAtRef.current = t;
        }
      }
      if (streamEndAtRef.current !== null) target = raw.length;

      // Rate-limited move toward target.
      const backlog = target - display.length;
      let pace = paceRef.current;
      if (backlog > 0) {
        // Track how fast the target itself is moving (chars/frame) plus a
        // bounded share of the standing gap.
        const want = Math.max(1, Math.min(24, backlog * 0.25 + 1));
        pace = pace * 0.7 + want * 0.3;
      } else if (display.length < raw.length) {
        // Buffer dry (upstream gap longer than the smoothing delay): keep
        // trickling the remaining undisplayed tail at a gentle minimum so
        // the stream never hard-stops mid-message — it reads as the model
        // thinking between sentences, which is exactly what is happening.
        pace = Math.max(pace * 0.9, 2);
      } else {
        pace *= 0.85;
      }
      paceRef.current = pace;

      if (backlog <= 0 && pace < 0.5 && display.length === raw.length) {
        return; // fully caught up; wait for input
      }
      const step = Math.max(1, Math.round(Math.min(pace, Math.max(backlog, 1))));
      const next = nextTypewriterText(display, raw, Math.max(1, Math.min(step, 24)));
      if (next === null) return;
      displayRef.current = next;
      setDisplayText(next);
      if (next.length < raw.length || target > next.length) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    if (displayRef.current !== rawText && rafRef.current === null) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [active, rawText]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  return displayText;
}
