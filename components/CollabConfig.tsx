"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";

interface CollabConfig {
  relayUrl: string;
  webUrl: string;
  shareServerUrl: string;
  shareStore: "blob" | "gist";
  redactSecrets: boolean;
  displayName: string;
}

type ShareState =
  | { kind: "idle" }
  | { kind: "sharing" }
  | { kind: "success"; url: string }
  | { kind: "error"; message: string };

const modalStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  background: "rgba(0,0,0,0.4)",
};

const dialogStyle: React.CSSProperties = {
  width: 520,
  maxWidth: "100%",
  maxHeight: "min(80vh, 640px)",
  overflow: "auto",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-lg)",
  background: "color-mix(in srgb, var(--bg-floating) 88%, transparent)",
  backdropFilter: "blur(16px) saturate(1.15)",
  WebkitBackdropFilter: "blur(16px) saturate(1.15)",
  boxShadow: "var(--shadow-modal)",
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  border: "1px solid var(--border)",
  borderRadius: 5,
  background: "var(--bg)",
  color: "var(--text)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
};

export function CollabConfig({
  sessionId,
  sessionName,
  onClose,
}: {
  sessionId: string | null;
  sessionName: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [config, setConfig] = useState<CollabConfig | null>(null);
  const [share, setShare] = useState<ShareState>({ kind: "idle" });
  const [joinInput, setJoinInput] = useState("");
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/collab")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: CollabConfig) => { if (!cancelled) setConfig(data); })
      .catch(() => { if (!cancelled) setConfig(null); });
    return () => { cancelled = true; };
  }, []);

  const handleShare = useCallback(async () => {
    if (!sessionId) return;
    setShare({ kind: "sharing" });
    try {
      const res = await fetch("/api/collab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "share", sessionId }),
      });
      const data = await res.json() as { url?: string; message?: string; error?: string };
      if (!res.ok || !data.url) {
        setShare({ kind: "error", message: data.message ?? data.error ?? `HTTP ${res.status}` });
        return;
      }
      setShare({ kind: "success", url: data.url });
    } catch (error) {
      setShare({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [sessionId]);

  const handleJoin = useCallback(async () => {
    const link = joinInput.trim();
    if (!link) return;
    setJoinBusy(true);
    setJoinError(null);
    setJoinUrl(null);
    try {
      const res = await fetch("/api/collab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join", link }),
      });
      const data = await res.json() as { url?: string; message?: string; error?: string };
      if (!res.ok || !data.url) {
        setJoinError(data.message ?? data.error ?? `HTTP ${res.status}`);
        return;
      }
      setJoinUrl(data.url);
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : String(error));
    } finally {
      setJoinBusy(false);
    }
  }, [joinInput]);

  const copy = useCallback(async (key: string, value: string) => {
    try {
      await copyText(value);
      setCopied(key);
      setTimeout(() => setCopied((prev) => (prev === key ? null : prev)), 1500);
    } catch {
      // ignore clipboard failures
    }
  }, []);

  const shareBusy = share.kind === "sharing";

  return (
    <div
      role="presentation"
      style={modalStyle}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="collab-title" style={dialogStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: "var(--accent)" }}>
              <circle cx="9" cy="9" r="2" />
              <circle cx="17" cy="9" r="2" />
              <circle cx="13" cy="17" r="2" />
              <path d="M7.5 10.5 10 12M14 12l2.5-1.5M10 16l3-2M12 15l-1 2" />
            </svg>
            <div id="collab-title" style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              {t("collab.title")}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("collab.close")}
            style={{ border: "none", background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18, padding: "0 2px", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Share (static encrypted snapshot) */}
          <section>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
              {t("collab.shareTitle")}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 10 }}>
              {t("collab.shareBody")}
            </div>
            {!sessionId ? (
              <div style={{ fontSize: 11, color: "var(--text-dim)", fontStyle: "italic" }}>
                {t("collab.noSession")}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleShare}
                  disabled={shareBusy}
                  style={{
                    height: 32, padding: "0 12px", border: "1px solid var(--accent)",
                    borderRadius: 5, background: "var(--accent)", color: "white",
                    cursor: shareBusy ? "wait" : "pointer", opacity: shareBusy ? 0.7 : 1,
                    fontSize: 12, fontWeight: 600,
                  }}
                >
                  {shareBusy ? t("collab.sharing") : t("collab.generateShare")}
                </button>
                {sessionName && (
                  <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-dim)" }}>
                    {t("collab.session")}: {sessionName}
                  </div>
                )}
                {share.kind === "success" && (
                  <div style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "center" }}>
                    <code style={{ ...fieldStyle, overflowWrap: "anywhere", whiteSpace: "normal" }}>{share.url}</code>
                    <button
                      type="button"
                      onClick={() => void copy("share", share.url)}
                      style={{ flexShrink: 0, height: 30, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 5, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}
                    >
                      {copied === "share" ? t("collab.copied") : t("collab.copy")}
                    </button>
                  </div>
                )}
                {share.kind === "error" && (
                  <div role="alert" style={{ marginTop: 10, color: "var(--error)", fontSize: 12, lineHeight: 1.5 }}>
                    {share.message}
                  </div>
                )}
              </>
            )}
          </section>

          {/* Collab (live) */}
          <section style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
              {t("collab.liveTitle")}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 10 }}>
              {t("collab.liveBody")}
            </div>
            {config && (
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 10 }}>
                {t("collab.webUrl")}: <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{config.webUrl}</code>
              </div>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={joinInput}
                onChange={(event) => setJoinInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && !joinBusy) void handleJoin(); }}
                placeholder={t("collab.joinPlaceholder")}
                aria-label={t("collab.joinPlaceholder")}
                style={{ ...fieldStyle, flex: 1 }}
              />
              <button
                type="button"
                onClick={() => void handleJoin()}
                disabled={joinBusy || !joinInput.trim()}
                style={{
                  height: 32, padding: "0 12px", border: "1px solid var(--border)",
                  borderRadius: 5, background: "transparent", color: "var(--text)",
                  cursor: joinBusy || !joinInput.trim() ? "not-allowed" : "pointer",
                  opacity: joinBusy || !joinInput.trim() ? 0.5 : 1, fontSize: 12,
                }}
              >
                {t("collab.join")}
              </button>
            </div>
            {joinError && (
              <div role="alert" style={{ marginTop: 8, color: "var(--error)", fontSize: 12, lineHeight: 1.5 }}>
                {joinError}
              </div>
            )}
            {joinUrl && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <code style={{ ...fieldStyle, overflowWrap: "anywhere", whiteSpace: "normal" }}>{joinUrl}</code>
                  <button
                    type="button"
                    onClick={() => void copy("join", joinUrl)}
                    style={{ flexShrink: 0, height: 30, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 5, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}
                  >
                    {copied === "join" ? t("collab.copied") : t("collab.copy")}
                  </button>
                </div>
                <a
                  href={joinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-block", marginTop: 8, color: "var(--accent)", fontSize: 12, textDecoration: "none" }}
                >
                  {t("collab.openJoin")} →
                </a>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
