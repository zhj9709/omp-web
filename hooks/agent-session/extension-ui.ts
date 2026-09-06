"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import { isBlockingExtensionUiRequest } from "@/lib/browser-notifications";
import type {
  BlockingExtensionUiRequest,
  ExtensionStatusItem,
  ExtensionUiRequest,
  ExtensionWidgetItem,
} from "@/lib/types";
import type { ChatInputHandle, ExtensionUiCustomRequest, ExtensionUiDialogRequest } from "./types";
import type { NoticeType } from "./notices";

export interface ExtensionUiDeps {
  sessionIdRef: RefObject<string | null>;
  chatInputRef?: RefObject<ChatInputHandle | null>;
  onAttentionNeeded?: (request: BlockingExtensionUiRequest) => void;
  addNotice: (notice: { id?: string; message: string; type?: NoticeType }) => void;
}

export function useExtensionUi({ sessionIdRef, chatInputRef, onAttentionNeeded, addNotice }: ExtensionUiDeps) {
  const [extensionDialog, setExtensionDialog] = useState<ExtensionUiDialogRequest | null>(null);
  const [extensionCustomUi, setExtensionCustomUi] = useState<ExtensionUiCustomRequest | null>(null);
  const [extensionStatuses, setExtensionStatuses] = useState<ExtensionStatusItem[]>([]);
  const [extensionWidgets, setExtensionWidgets] = useState<ExtensionWidgetItem[]>([]);
  // Original document.title captured before an extension setTitle override, so
  // unmount can restore it instead of leaving the tab title stale.
  const documentTitleRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (documentTitleRef.current !== null) {
      document.title = documentTitleRef.current;
      documentTitleRef.current = null;
    }
  }, []);

  const respondToExtensionUi = useCallback(async (
    request: ExtensionUiDialogRequest,
    response: { value: string } | { confirmed: boolean } | { cancelled: true },
  ) => {
    const sid = sessionIdRef.current;
    setExtensionDialog((current) => current?.id === request.id ? null : current);
    if (!sid) return;
    try {
      await sendAgentCommand(sid, {
        type: "extension_ui_response",
        id: request.id,
        ...response,
      });
    } catch (e) {
      console.error("Failed to send extension UI response:", e);
    }
  }, [sessionIdRef]);

  const sendExtensionCustomInput = useCallback(async (request: ExtensionUiCustomRequest, data: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, {
        type: "extension_ui_input",
        id: request.id,
        data,
      });
    } catch (e) {
      console.error("Failed to send extension custom UI input:", e);
    }
  }, [sessionIdRef]);

  const handleExtensionUiRequest = useCallback((request: ExtensionUiRequest) => {
    if (isBlockingExtensionUiRequest(request)) onAttentionNeeded?.(request);

    switch (request.method) {
      case "select":
      case "confirm":
      case "input":
      case "editor":
        setExtensionDialog(request);
        break;
      case "notify": {
        addNotice({
          id: request.id,
          message: request.message,
          type: request.notifyType ?? "info",
        });
        break;
      }
      case "setStatus":
        setExtensionStatuses((prev) => {
          const rest = prev.filter((item) => item.key !== request.statusKey);
          return request.statusText !== undefined
            ? [...rest, { key: request.statusKey, text: request.statusText }]
            : rest;
        });
        break;
      case "setWidget":
        setExtensionWidgets((prev) => {
          const rest = prev.filter((item) => item.key !== request.widgetKey);
          return request.widgetLines
            ? [...rest, {
                key: request.widgetKey,
                lines: request.widgetLines,
                placement: request.widgetPlacement ?? "aboveEditor",
              }]
            : rest;
        });
        break;
      case "setTitle":
        if (request.title) {
          if (documentTitleRef.current === null) {
            documentTitleRef.current = document.title;
          }
          document.title = request.title;
        }
        break;
      case "set_editor_text":
        chatInputRef?.current?.insertText(request.text);
        break;
      case "custom":
        setExtensionCustomUi((current) => {
          if (request.closed) return current?.id === request.id ? null : current;
          return request;
        });
        break;
    }
  }, [addNotice, onAttentionNeeded, chatInputRef]);

  return {
    extensionDialog,
    extensionCustomUi,
    extensionStatuses,
    extensionWidgets,
    respondToExtensionUi,
    sendExtensionCustomInput,
    handleExtensionUiRequest,
  };
}
