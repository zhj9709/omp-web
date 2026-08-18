/**
 * OAuth login adapter for OMP RPC.
 *
 * OMP exposes two RPC commands for browser-based authentication:
 *   - `get_login_providers` -> { providers: [{ id, name, available, authenticated }] }
 *   - `login { providerId }`  -> long-running command that emits extension UI
 *     requests (`open_url` to open the browser, `notify` for progress, `input`
 *     as a manual-code fallback) and resolves when the browser callback server
 *     (localhost) receives the OAuth redirect.
 *
 * This module adapts that flow to the pi-web SSE event contract the frontend
 * already consumes (`auth` / `prompt_request` / `progress` / `success` /
 * `error`), plus a token-keyed registry so the manual-code POST can route its
 * value back to the right `extension_ui_response`.
 */

import { OmpRpcClient } from "./rpc-client";

export interface OAuthProviderInfo {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
}

export function getOmpBinary(): string {
  return process.env.OMP_BINARY ?? "omp";
}

/** Login provider shape returned by OMP RPC `get_login_providers`. */
interface OmpLoginProvider {
  id: string;
  name: string;
  available: boolean;
  authenticated: boolean;
}

/**
 * List OAuth providers from OMP RPC. Each call spawns a short-lived RPC
 * process, which is the only way OMP advertises login providers.
 */
export async function getOAuthProviders(): Promise<OAuthProviderInfo[]> {
  const client = new OmpRpcClient({});
  try {
    await client.start();
    const data = await client.sendCommand<{ providers?: OmpLoginProvider[] }>({
      type: "get_login_providers",
    });
    return (data.providers ?? [])
      .filter((p) => p.available)
      .map((p) => ({
        id: p.id,
        name: p.name,
        usesCallbackServer: true,
        loggedIn: p.authenticated,
      }));
  } finally {
    client.dispose();
  }
}

// ---------------------------------------------------------------------------
// Pending-login registry
//
// The GET route opens an SSE stream and starts a long-running `login` command.
// The manual-code fallback (`input` extension UI request) has its own request
// id; the frontend POSTs `{ token, code }` back and this registry routes the
// code to the `extension_ui_response` for that pending input request.
// ---------------------------------------------------------------------------

export interface PendingLogin {
  provider: string;
  client: OmpRpcClient;
  /** Latest `input` extension-UI request id, once observed. */
  inputId: string | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __ompLoginCallbacks: Map<string, PendingLogin> | undefined;
}

function getLoginRegistry(): Map<string, PendingLogin> {
  if (!globalThis.__ompLoginCallbacks) {
    globalThis.__ompLoginCallbacks = new Map();
  }
  return globalThis.__ompLoginCallbacks;
}

export function registerPendingLogin(token: string, entry: PendingLogin): void {
  getLoginRegistry().set(token, entry);
}

export function unregisterPendingLogin(token: string): void {
  getLoginRegistry().delete(token);
}

export function getPendingLogin(token: string): PendingLogin | undefined {
  return getLoginRegistry().get(token);
}
