"use client";

import { useEffect, type RefObject } from "react";

/** Anchor position for a portalled row menu, clamped to the viewport. */
export function menuPositionFrom(anchor: HTMLElement): { top: number; left: number } {
  const r = anchor.getBoundingClientRect();
  return { top: r.bottom + 4, left: Math.max(4, Math.min(r.left, window.innerWidth - 180)) };
}

/**
 * Close a portalled row menu on outside pointerdown or Escape. (No scroll
 * dismissal: capture-phase scroll fires for unrelated regions — e.g. the chat
 * pane auto-scrolling — and would yank the menu shut.)
 */
export function useDismissableMenu(
  open: boolean,
  onClose: () => void,
  menuRef: RefObject<HTMLElement | null>,
  anchorRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: Event) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, menuRef, anchorRef]);
}
