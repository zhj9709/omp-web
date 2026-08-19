# OMP Web Architecture Baseline

## Runtime Architecture

OMP Web connects to the OMP runtime via `omp --mode rpc` over stdio JSONL. The Next.js
server spawns the OMP binary as a child process and communicates through stdin/stdout
using the JSONL RPC protocol (v2 handshake). This replaces the in-process pi SDK used by
pi-web.

Session files are stored as `.jsonl` files under `~/.omp/agent/sessions/`. OMP Web reads
these files directly for session listing and browsing without spawning an OMP process.

The two tracks are independent:

1. **Read-only JSONL track** — session listing, browsing, context reconstruction
   (`lib/session-reader.ts`). No OMP process, no pi SDK.
2. **OMP RPC track** — agent execution via `omp --mode rpc` (`lib/rpc-client.ts` +
   `lib/rpc-manager.ts`).

## Verified Status

The following has been verified end-to-end on this checkout:

| Check | Result |
| --- | --- |
| `npm install` | passes |
| `tsc --noEmit` | 0 errors |
| `next build` | succeeds |
| Server start (port `30142`) | serves |
| Security gates (401/403) | enforced |
| Session list / agent running / models / auth providers | HTTP 200 |
| Browser UI | no fatal errors |

## Capability Matrix

| Area | Status | Notes |
| --- | --- | --- |
| Session browsing | Available (read-only) | Direct JSONL reads of real OMP sessions |
| Agent execution | Available | Spawns `omp --mode rpc` (v2 handshake verified) |
| Model list | Available (read-only) | Reads `models.db` + `config.yml` + `models.yaml` (API keys stripped) |
| Plugin management | Partial | `omp plugin list --json` + `omp plugin install/remove/enable/disable`; `update` is `feature_unavailable` |
| Skills | Available (read-only) | Filesystem discovery of `managed-skills` |
| Auth (API key / OAuth login / logout) | Unavailable | HTTP 501 `feature_unavailable` |
| Model config write | Available | Deep-merge onto `models.yaml` — unseen credentials/`discovery`/`modelOverrides` preserved, backup + atomic write |
| Model test | Unavailable | HTTP 501 — use the OMP CLI |
| Model discovery | Partial | Fetches upstream model list; API key from request body or `models.yaml` (server-side only) |
| Session rename / delete | Available | Rename via RPC `set_session_name` (live) or header rewrite (on disk); delete stops the live run and cascade-reparents children |
| Session auto-name | Available | Generates a title from the first user message via the OMP-configured model; falls back to the message prefix on failure |
| Session HTML export | Available | Renders through OMP RPC `export_html` and downloads the file |
| Settings editor | Available | Full config.yml editor (`/api/config` deep-merge, credentials redacted) |
| Memory browser | Available (read-only) | Per-project mnemopi banks under `~/.omp/agent/memories/` |
| Usage dashboard | Available | Aggregates token/cost from session jsonl files (`/api/usage`) |
| Command palette | Available | Cmd/Ctrl+K — actions, session jump, fuzzy file search |
| Project trust | Unavailable | OMP v17.3.5 has no trust system; GET returns fixed "not applicable" |
| Tool filtering (`toolNames`) | Unavailable | `capability_unavailable` (`tool_filtering`) |
| Fork at a specific entry | Unavailable | `capability_unavailable` (`fork_at_entry`) |

## Security

OMP Web MUST NOT read or echo credentials, API keys, tokens, or any sensitive fields from
OMP's credential storage. Authentication flows go through the OMP RPC process or the OMP
CLI. `models.yaml` parsing strips API keys before they reach the client.

## Running

```bash
npm run dev    # port 30142
```

- Port: `30142` (or `PORT`).
- `OMP_WEB_PASSWORD`: enable HTTP Basic Auth (username `omp`).
- `OMP_BINARY`: absolute path to the `omp` binary (defaults to `omp` on PATH).

## Known Limitations

- `toolNames` on `POST /api/agent/new` returns `capability_unavailable` (`tool_filtering`).
- `fork` with an `entryId` returns `capability_unavailable` (`fork_at_entry`); OMP RPC
  `new_session` forks the whole transcript and has no per-entry truncation.
- Auth write endpoints (API key, OAuth login/logout) return HTTP 501 `feature_unavailable`.
- Model connectivity test returns HTTP 501 `feature_unavailable`.
- The app version shown may be `0.0.0` when `NEXT_PUBLIC_APP_VERSION` is unset.

## Environment Variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Server port | `30142` |
| `OMP_WEB_HOSTNAME` | Bind hostname | `127.0.0.1` |
| `OMP_WEB_NO_OPEN` | Disable auto browser open | Unset |
| `OMP_WEB_ALLOWED_HOSTS` | Additional proxy hostnames | Unset |
| `OMP_WEB_PASSWORD` | HTTP Basic Auth password | Auth disabled |
| `OMP_BINARY` | Path to the `omp` binary | `omp` |
