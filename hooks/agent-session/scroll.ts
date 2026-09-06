"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { AgentMessage } from "@/lib/types";
import {
  CHAT_SCROLL_REATTACH_TOLERANCE,
  CHAT_SCROLL_TAIL_TOLERANCE,
  getLiveFollowAttached,
} from "@/lib/chat-lazy-load";

export interface ChatScrollDeps {
  agentRunningRef: RefObject<boolean>;
  messages: AgentMessage[];
  loading: boolean;
  agentRunning: boolean;
}

export function useChatScroll({ agentRunningRef, messages, loading, agentRunning }: ChatScrollDeps) {
  const [promptAnchorActive, setPromptAnchorActive] = useState(false);
  const initialScrollDoneRef = useRef(false);
  const lastUserMsgRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToUserRef = useRef(false);
  const isNearBottomRef = useRef(true);
  const previousScrollTopRef = useRef(0);
  const liveFollowFrameRef = useRef<number | null>(null);
  // Live pin target during the prompt-anchor phase, written by ChatWindow's
  // spacer measurement: the scrollTop that keeps the just-sent user message
  // at the top of the viewport, or null once the streaming content outgrows
  // the viewport (spacer drained) and bottom-following should resume.
  const promptAnchorPinTopRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = scrollContainerRef.current;
    const pinTop = promptAnchorPinTopRef.current;
    if (pinTop !== null && container) {
      // Prompt-anchor phase: hold the just-sent user message at the top of
      // the viewport instead of chasing the scroll bottom. The bottom moves
      // with every streamed token (the anchor spacer shrinks as the response
      // grows), so chasing it makes the spacer update and the follow scroll
      // land in different frames — the visible ±30px oscillation. The pin
      // target is fixed for the whole phase, so both writers converge on it.
      container.scrollTo({
        top: Math.min(pinTop, Math.max(0, container.scrollHeight - container.clientHeight)),
        behavior: "auto",
      });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior });
    }
    if (container) previousScrollTopRef.current = container.scrollTop;
  }, []);

  const scrollUserMsgToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    const el = lastUserMsgRef.current;
    if (!container || !el) return;
    const elAbsTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const targetTop = Math.min(Math.max(0, elAbsTop - 16), maxScrollTop);

    if (liveFollowFrameRef.current !== null) {
      cancelAnimationFrame(liveFollowFrameRef.current);
      liveFollowFrameRef.current = null;
    }
    isNearBottomRef.current = true;
    previousScrollTopRef.current = targetTop;
    container.scrollTo({ top: targetTop, behavior: "auto" });
  }, []);

  const handleScrollPositionChange = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      const { scrollTop, clientHeight, scrollHeight } = container;
      const isAgentRunning = agentRunningRef.current;
      const wasAttached = isNearBottomRef.current;
      const isAttached = getLiveFollowAttached(
        wasAttached,
        previousScrollTopRef.current,
        scrollTop,
        clientHeight,
        scrollHeight,
        isAgentRunning
          ? CHAT_SCROLL_REATTACH_TOLERANCE
          : CHAT_SCROLL_TAIL_TOLERANCE,
      );
      isNearBottomRef.current = isAttached;
      previousScrollTopRef.current = scrollTop;
      if (!wasAttached && isAttached && isAgentRunning) {
        scrollToBottom("auto");
      } else if (!isAttached && liveFollowFrameRef.current !== null) {
        cancelAnimationFrame(liveFollowFrameRef.current);
        liveFollowFrameRef.current = null;
      }
    }
  }, [agentRunningRef, scrollToBottom]);

  useEffect(() => {
    if (!agentRunning) setPromptAnchorActive(false);
  }, [agentRunning]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    previousScrollTopRef.current = container.scrollTop;
    container.addEventListener("scroll", handleScrollPositionChange, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScrollPositionChange);
    };
  }, [messages.length, loading, handleScrollPositionChange]);

  useLayoutEffect(() => {
    if (messages.length > 0) {
      if (pendingScrollToUserRef.current) {
        pendingScrollToUserRef.current = false;
        initialScrollDoneRef.current = true;
        scrollUserMsgToTop();
      } else if (!initialScrollDoneRef.current) {
        initialScrollDoneRef.current = true;
        scrollToBottom("auto");
      } else if (isNearBottomRef.current) {
        // Follow new messages while the agent is running too: the tail-tracking
        // ref already encodes "user is at the bottom", so appends (queue
        // deliveries, message_end, reloads) keep the viewport pinned to the
        // latest message instead of stranding it mid-conversation.
        scrollToBottom("auto");
      }
    }
  }, [messages.length, agentRunning, scrollToBottom, scrollUserMsgToTop]);

  useEffect(() => () => {
    if (liveFollowFrameRef.current !== null) {
      cancelAnimationFrame(liveFollowFrameRef.current);
      liveFollowFrameRef.current = null;
    }
  }, []);

  return {
    promptAnchorActive,
    setPromptAnchorActive,
    initialScrollDoneRef,
    lastUserMsgRef,
    pendingScrollToUserRef,
    isNearBottomRef,
    liveFollowFrameRef,
    promptAnchorPinTopRef,
    messagesEndRef,
    scrollContainerRef,
    scrollToBottom,
    scrollUserMsgToTop,
    handleScrollPositionChange,
  };
}
