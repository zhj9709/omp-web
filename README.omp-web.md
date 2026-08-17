# OMP Web Architecture Baseline

## Runtime Architecture

OMP Web connects to the OMP runtime via `omp --mode rpc` over stdio JSONL. The Next.js server spawns the OMP binary as a child process and communicates through stdin/stdout using the JSONL RPC protocol. This replaces the in-process pi SDK used by pi-web.

Session files are stored as `.jsonl` files under `~/.omp/agent/sessions/`. OMP Web reads these files directly for session listing and browsing without spawning an OMP process.

## Security

OMP Web MUST NOT read or echo credentials, API keys, tokens, or any sensitive fields from OMP's credential storage. Authentication flows go through the OMP RPC process.

## Adaptation Status

This is a **bootstrap baseline** — not yet runnable. The project identity has been renamed from pi-web to omp-web, but the core agent runtime integration still uses the pi SDK.

**Awaiting adaptation:**
- `lib/rpc-manager.ts` — pi `AgentSession` in-process → `omp --mode rpc` child process
- `lib/session-reader.ts` — pi `SessionManager` helpers → direct JSONL file reading
- `lib/pi-types.ts` — pi SDK type wrappers → OMP RPC protocol types
- API routes `app/api/agent/*` — pi SDK session management → OMP RPC process management
- `package.json` dependencies — `@earendil-works/pi-*` → OMP binary dependency

**Preserved from pi-web baseline:**
- Security gates, file path allow-lists, Basic Auth, PWA, i18n
- CSS theming, UI components, hooks
- `lib/rpc-manager.ts` and `lib/session-reader.ts` kept as-is for adaptation agents

## Environment Variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Server port | `30142` |
| `OMP_WEB_HOSTNAME` | Bind hostname | `127.0.0.1` |
| `OMP_WEB_NO_OPEN` | Disable auto browser open | Unset |
| `OMP_WEB_ALLOWED_HOSTS` | Additional proxy hostnames | Unset |
| `OMP_WEB_PASSWORD` | HTTP Basic Auth password | Auth disabled |