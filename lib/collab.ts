import { execFile, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { promisify } from "node:util";
import { readOmpConfig } from "./omp-models";

const execFileAsync = promisify(execFile);

/**
 * OMP collab/share integration.
 *
 * OMP RPC mode has no collab command — live session sharing (`/collab`) and
 * joining (`/join`) live in the TUI. This module exposes the two surfaces that
 * *are* scriptable from a browser host:
 *
 *   1. Static share links (`omp share <session>`) — an encrypted session
 *      snapshot anyone can open in a browser viewer.
 *   2. The collab web client URL + join-link construction — `collab.webUrl`
 *      (derived from `collab.relayUrl`) hosts the browser UI that `/collab`
 *      and `/join` links open. The room id + key ride in the URL fragment.
 */

export interface CollabConfig {
  /** Relay used by /collab (wss://host[:port]). */
  relayUrl: string;
  /** Browser UI used by /collab links (http/https). */
  webUrl: string;
  /** Share viewer/upload base used by /share. */
  shareServerUrl: string;
  /** Where /share uploads: "blob" (share server) or "gist". */
  shareStore: "blob" | "gist";
  /** Whether /share runs the secret obfuscator before upload. */
  redactSecrets: boolean;
  /** Name shown to other collab participants. */
  displayName: string;
}

const DEFAULT_RELAY_URL = "wss://my.omp.sh";
const DEFAULT_SHARE_SERVER_URL = "https://my.omp.sh/s";

/** Derive the collab web client origin from a ws/wss relay URL. */
function relayToWebUrl(relayUrl: string): string {
  if (relayUrl.startsWith("wss://")) return `https://${relayUrl.slice(6)}`;
  if (relayUrl.startsWith("ws://")) return `http://${relayUrl.slice(5)}`;
  return relayUrl;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

/**
 * Read collab/share settings from OMP's config.yml with the same defaults the
 * CLI applies (`omp config get collab.relayUrl` etc.). Unset keys fall back to
 * the public relay/share server.
 */
export function getCollabConfig(): CollabConfig {
  const config = readOmpConfig();
  const collab = (config.collab ?? {}) as Record<string, unknown>;
  const share = (config.share ?? {}) as Record<string, unknown>;

  const relayUrl = asString(collab.relayUrl, DEFAULT_RELAY_URL);
  const webUrl = asString(collab.webUrl, relayToWebUrl(relayUrl));
  const shareServerUrl = asString(share.serverUrl, DEFAULT_SHARE_SERVER_URL);
  const shareStore = share.store === "gist" ? "gist" : "blob";
  // parseSimpleYaml stores nested map values as raw strings, so accept both
  // boolean false and the string "false" as an explicit opt-out.
  const redactSecrets = share.redactSecrets !== false && share.redactSecrets !== "false";
  const displayName = asString(collab.displayName, "");
  return {
    relayUrl,
    webUrl,
    shareServerUrl,
    shareStore,
    redactSecrets,
    displayName,
  };
}

/**
 * Build the browser deep link for a collab join link.
 *
 * Accepts either form the CLI emits:
 *   - compact terminal link:  "my.omp.sh/abc123.key"
 *   - click-to-join deep link: "https://my.omp.sh/#my.omp.sh/abc123.key"
 *
 * The room id + key ride in the URL fragment so they never appear in any HTTP
 * request. Non-http(s) compact links are rewritten as `<webUrl>/#<link>`.
 */
export function buildCollabJoinUrl(rawLink: string, webUrl?: string): string {
  const link = rawLink.trim();
  if (!link) return "";

  if (/^https?:\/\//i.test(link)) return link;

  const base = (webUrl ?? getCollabConfig().webUrl).replace(/\/+$/, "");
  return `${base}/#${link.replace(/^#+/, "")}`;
}

export interface ShareResult {
  url: string;
}

/**
 * Share a saved session via `omp share <path>` and parse the emitted URL.
 *
 * stdin is ignored: `omp share` otherwise blocks reading it (it boots the same
 * session machinery the interactive TUI uses). The command prints a single
 * `Share URL: <url>` line on stdout.
 */
export async function shareSession(
  sessionPath: string,
  options: { gist?: boolean; timeoutMs?: number } = {},
): Promise<ShareResult> {
  const ompBin = process.env.OMP_BINARY ?? "omp";
  const args = ["share", sessionPath];
  if (options.gist) args.push("--gist");

  // stdin must be ignored: `omp share` otherwise blocks reading it (it boots
  // the same session machinery the interactive TUI uses). execFile forwards
  // stdio to spawn at runtime, but @types/node omits it from ExecFileOptions,
  // so intersect the spawn shape to keep the type honest.
  const execOptions: ExecFileOptionsWithStringEncoding & {
    stdio: ["ignore", "pipe", "pipe"];
  } = {
    timeout: options.timeoutMs ?? 60_000,
    env: { ...process.env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024,
  };
  const { stdout, stderr } = await execFileAsync(ompBin, args, execOptions);

  const match = /Share URL:\s*(\S+)/.exec(stdout);
  if (match) return { url: match[1] };

  throw new Error(
    (stderr || stdout).trim() || "Failed to share session (no share URL emitted)",
  );
}
