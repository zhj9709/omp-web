"use client";

import { useEffect, useState } from "react";

const BLOB_PREFIX = "blob:sha256:";

const cache = new Map<string, string>();

/**
 * Resolve an OMP CLI `blob:sha256:<hex>` image reference to a `data:` URL by
 * fetching the bytes from `/api/sessions/[id]/entries/[entryId]/image`.
 * Returns the original src untouched when the input is not a blob ref, and
 * the empty string while the fetch is in flight so callers can render a
 * placeholder or skip rendering.
 */
export function useResolvedImageSrc(
  src: string,
  options: { sessionId?: string; entryId?: string } = {},
): string {
  const { sessionId, entryId } = options;
  const [resolved, setResolved] = useState<string>(() => {
    if (!src.startsWith(BLOB_PREFIX)) return src;
    const key = `${sessionId ?? ""}/${entryId ?? ""}/${src}`;
    return cache.get(key) ?? "";
  });

  useEffect(() => {
    if (!src.startsWith(BLOB_PREFIX)) {
      setResolved(src);
      return;
    }
    if (!sessionId || !entryId) return;
    const key = `${sessionId}/${entryId}/${src}`;
    const cached = cache.get(key);
    if (cached) {
      setResolved(cached);
      return;
    }
    let cancelled = false;
    const sha256 = src.slice(BLOB_PREFIX.length);
    const url = `/api/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/image?sha256=${sha256}`;
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const contentType = res.headers.get("Content-Type") ?? "application/octet-stream";
        const buffer = await res.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]);
        const dataUrl = `data:${contentType};base64,${btoa(binary)}`;
        if (!cancelled) {
          cache.set(key, dataUrl);
          setResolved(dataUrl);
        }
      })
      .catch(() => {
        // Leave src empty; the caller will skip rendering or show a placeholder.
      });
    return () => {
      cancelled = true;
    };
  }, [src, sessionId, entryId]);

  return resolved;
}