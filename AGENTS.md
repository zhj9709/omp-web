# OMP Web - Development Notes

## Quick Start

```bash
npm run dev   # port 30142
```

Typecheck: `node_modules/.bin/tsc --noEmit`
Lint: `npm run lint`
**Never run `next build` during dev** — pollutes `.next/` and breaks `npm run dev`.

---

## Architecture

OMP Web has **two independent tracks** for talking to the OMP runtime:

1. **Read-only JSONL track** (`lib/session-reader.ts`): session listing, browsing, and
   context reconstruction read `.jsonl` session files directly from disk. No OMP process
   is spawned for any read path.
2. **OMP RPC track** (`lib/rpc-client.ts` + `lib/rpc-manager.ts`): running an agent turn
   spawns `omp --mode rpc` as a child process and speaks JSONL RPC over stdin/stdout.

```
Browser                 Next.js Server                        omp child process
  │                          │                                     │
  ├─ GET /api/sessions ──────▶ reads ~/.omp/agent/sessions/*.jsonl  │   (no process)
  ├─ GET /api/sessions/[id] ▶ reads the .jsonl file directly        │
  ├─ GET /api/agent/running ▶ in-memory running-id snapshot         │
  │                          │                                     │
  ├─ send message ──────────▶ POST /api/agent/[id]                  │
  │                          │   startRpcSession() ────────────────▶│ spawn omp --mode rpc
  │                          │   session.send(cmd) ────────────────▶│ JSONL RPC (v2 handshake)
  │                          │                                     │
  ├─ SSE connect ───────────▶ GET /api/agent/[id]/events            │
  │                          │   session.onEvent() ◀───────────────│ forwarded events
  │◀── data: {...} ──────────│                                     │
```

- **Session browsing** (read-only): `session-reader.ts` parses `.jsonl` directly. It never
  imports the pi SDK and never spawns a process.
- **Running a turn**: `startRpcSession()` in `rpc-manager.ts` wraps an `OmpRpcClient`
  (`rpc-client.ts`), which spawns `omp --mode rpc`, negotiates the ready frame (v2), and
  multiplexes command/response frames plus session/agent events.

### RPC binary resolution

`OmpRpcClient` resolves the binary as `process.env.OMP_BINARY ?? "omp"`. Set `OMP_BINARY`
to an absolute path to point OMP Web at a specific binary.

### Command mapping (`rpc-manager.ts`)

Commands that map 1:1 to OMP RPC: `prompt`, `steer`, `follow_up`, `abort`, `get_state`,
`set_model`, `set_thinking_level`, `compact`, `set_session_name`, `get_session_stats`,
`get_last_assistant_text`, `set_auto_compaction`, `set_auto_retry`, `bash`, `abort_bash`,
`get_available_commands`. `navigate_tree` maps to OMP RPC `branch`.

Commands with **no** OMP RPC equivalent throw `CapabilityUnavailableError`
(`code: "capability_unavailable"`): `abort_compaction`, `clear_queue`, `reload`,
`extension_ui_input`.

Two pi-web features are explicitly rejected as `capability_unavailable`:
- **`toolNames` / tool filtering** (`POST /api/agent/new`) — `feature: "tool_filtering"`.
- **fork at a specific entry** (`entryId` on `fork`) — `feature: "fork_at_entry"`. OMP RPC
  `new_session` only accepts `parentSession` and forks the whole transcript; silently
  truncating differently would hand the caller a different history than requested, so it
  fails explicitly instead.

---

## File Map

```
app/api/
  agent/new/route.ts                       POST create a session (toolNames → capability_unavailable)
  agent/[id]/route.ts                      GET state | POST any command
  agent/[id]/events/route.ts               GET SSE stream
  agent/[id]/bash-output/route.ts          GET bash temp file referenced by this session
  agent/running/route.ts                   GET currently-running session ids
  agent/running/events/route.ts            GET SSE stream of running ids
  app-update/route.ts                      GET npm latest release version
  auth/all-providers/route.ts              GET API-key provider list
  auth/api-key/[provider]/route.ts         GET/POST/DELETE — 501 feature_unavailable
  auth/login/[provider]/route.ts           GET OAuth login SSE (RPC `login`) | POST manual code
  auth/logout/[provider]/route.ts          POST logout via `omp auth-broker logout`
  auth/providers/route.ts                  GET OAuth provider list
  cwd/browse/route.ts                      GET list readable subdirectories
  cwd/validate/route.ts                    POST validate/select a cwd
  default-cwd/route.ts                     POST create a default cwd
  file-index/route.ts                      GET file index + fuzzy search
  files/[...path]/route.ts                 GET file contents for viewer
  git/diff/route.ts                        GET git diff for a file
  git/status/route.ts                      GET git status for a cwd
  home/route.ts                            GET user home directory
  models/route.ts                          GET models (models.db + config.yml + models.yaml, sanitized)
  models-config/route.ts                   GET read config | PUT deep-merge write (keys preserved)
  models-config/catalog/route.ts           GET models.dev pricing presets
  models-config/discover/route.ts          POST fetch a provider's upstream model list
  models-config/test/route.ts              POST — 501 feature_unavailable
  plugins/route.ts                         GET/POST package plugins via `omp plugin` CLI
  project-trust/route.ts                   GET fixed "not applicable" | POST — 501 feature_unavailable
  sessions/route.ts                        GET list all sessions
  sessions/[id]/route.ts                        GET | PATCH rename | DELETE (cascade-reparents children)
  sessions/[id]/auto-name/route.ts         POST generate title from first user message
  sessions/[id]/context/route.ts           GET ?leafId= — context for a specific leaf
  sessions/[id]/entries/[entryId]/thinking/route.ts  GET a thinking block
  sessions/[id]/export/route.ts            GET export session transcript as HTML download
  sessions/[id]/state/route.ts             GET running state
  skills/route.ts                          GET/PATCH loaded skills
  skills/check/route.ts                    POST check a skill for updates
  skills/install/route.ts                  POST install skills through npx
  skills/search/route.ts                   GET/POST skills.sh search
  skills/update/route.ts                   POST update a skill through npx
  worktrees/route.ts                       GET/POST/DELETE git worktrees
```

### feature_unavailable endpoints (HTTP 501)

These return `{ error: ..., feature_unavailable: true }` (or an equivalent message) and
must stay honest in the UI — they are not implemented in OMP RPC mode:

- `auth/api-key/[provider]` — API-key management (configure in `models.yaml` or use the OMP CLI).
- `models-config/test` — model connectivity testing (use the OMP CLI).
- `project-trust` POST — OMP v17.3.5 has no project-trust system (GET returns a fixed
  "not applicable" status; no trust gate exists).
- `plugins` POST with `action: "update"` — `omp plugin upgrade` may require interactive
  prompts; safe batch operation is not guaranteed.

`lib/` (runtime integration; test files omitted):
```
  rpc-client.ts           OmpRpcClient — spawn `omp --mode rpc`, JSONL RPC, v2 handshake
  rpc-manager.ts          OmpSessionWrapper + registry + startRpcSession + command mapping
  session-reader.ts       direct JSONL reading, session listing, getAgentDir(), path cache
  session-path.ts         session id/path encoding helpers
  session-file-references.ts  validate a bash-output path is referenced by a session
  omp-models.ts           reads models.db + config.yml + models.yaml (API keys stripped)
  model-catalog.ts        models.dev pricing presets
  model-discovery.ts      parse upstream model lists
  model-discovery-auth.ts resolve discovery API key (request body, else models.yaml)
  bash-output.ts          bash temp output resolution + inline size limits
  git-changes.ts          git status/diff helpers
  git-status.ts / git-types.ts
  directory-browser.ts    cwd browse helpers
  file-fuzzy.ts           file index + fuzzy search
  file-access.ts          allowed file roots + isFilePathAllowed security boundary
  allowed-roots.ts        allowed-root storage
  path-security.ts        isPathWithinRoots — the single security boundary implementation
  paths.ts                toNativePath / samePath
  normalize.ts            normalizeToolCalls()
  tool-presets.ts         PRESET_NONE/READ_ONLY/DEFAULT/FULL + getPresetFromTools()
  tool-preset-preference.ts  browser-persisted default for fresh sessions
  tool-names.ts           tool name lists
  skills-service.ts       managed-skills filesystem discovery
  skill-lock.ts           skill install lock annotation
  skill-updates.ts        skill update check/args
  npx.ts                  npx runner used by skill install/update
  startup-preferences.ts  persisted model/thinking prefs
  project-command-env.ts  local bash environment for project commands
  project-trust.ts        fixed "no trust system" status
  request-security.ts     API request allow-list (host/origin)
  web-auth.ts             HTTP Basic Auth
  worktree.ts             project/worktree resolution + git worktree operations
  markdown.ts / file-paths.ts / draft-store.ts / types.ts / api-types.ts / frontmatter.ts
  ansi.ts / clipboard.ts / model-scope helpers (frontend-only if present)
```

`components/`:
```
  AppShell.tsx        layout + URL state + tab management
  SessionSidebar.tsx  session tree + FileExplorer
  ChatWindow.tsx      chat composition + completion sound wrapper
  ChatInput.tsx       input bar + model/thinking/tools/compact controls
  MessageView.tsx     renders one message (user/assistant/toolCall/toolResult)
  BranchNavigator.tsx in-session branch switcher
  ChatMinimap.tsx     scroll minimap alongside the message list
  MarkdownBody.tsx    markdown renderer
  ModelsConfig.tsx    modal for model/provider config
  PluginsConfig.tsx   modal for installed package plugins
  SkillsConfig.tsx    modal for loaded/search/installable skills
  ProjectTrustDialog.tsx
  FileExplorer.tsx    file tree inside sidebar
  FileViewer.tsx      file content in a tab
  TabBar.tsx          tab bar (Chat + open file tabs)
  TurnWrittenFiles.tsx  files written in a turn
  ExtensionWidgets.tsx / ExtensionStatusBar.tsx
  ImagePreview.tsx / MermaidBlock.tsx / FrontmatterCard.tsx
  DirectoryPicker.tsx / PwaRegistration.tsx / MobilePwaLayout.tsx
```

`hooks/`:
```
  useAgentSession.ts   messages + streaming + SSE + fork/navigate/reconciliation logic
  useAudio.ts          completion sound + browser AudioContext unlock
  useDragDrop.ts       shared drag/drop state
  useI18n.tsx          i18n registry + locale switching
  useIsMobile.ts       responsive breakpoint hook
  useKeyboardShortcuts.ts
  useResizablePanel.ts
  useTheme.ts          theme state
  useViewportHeight.ts
```

---

## Key Design Decisions & Traps

### OmpSessionWrapper lifecycle (`lib/rpc-manager.ts`)
- One `OmpSessionWrapper` per session id, keyed in `globalThis.__ompSessions` (survives
  Next.js hot-reload; a plain module-level Map does not).
- Idle timeout: 10 minutes. Concurrent `startRpcSession()` calls share a single start
  Promise (`globalThis.__ompStartLocks`).

### Data directory is fixed: `~/.omp/agent`
`getAgentDir()` (`lib/session-reader.ts`) and `ompAgentDir()` (`lib/omp-models.ts`) both
resolve to `join(homedir(), ".omp", "agent")` with **no environment override**. Session
files live at `~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`.

### Models come from OMP storage, never from the pi SDK
`GET /api/models` reads `models.db` (SQLite), `config.yml`, and `models.yaml` under
`~/.omp/agent/`. `models.yaml` parsing strips API keys — keys are never returned to the
client. The only place a stored key is read is `model-discovery-auth.ts`, server-side, to
make an authenticated upstream model-list request.

`PUT /api/models-config` writes through `lib/models-config-writer.ts`: a deep merge onto
the on-disk yaml. Client-supplied scalars win; credentials and nested blocks the client
never sees (`apiKey`, `headers`, `discovery`, `modelOverrides`) are inherited from disk;
`""`/`undefined` never overwrite a stored credential; `models` is written only when it
differs from the current models.db listing (order-insensitive compare), so an untouched
save never freezes a `discovery: proxy` provider into a static list. Every write makes a
timestamped `.bak` and swaps the file atomically at mode `0600`.

### Skills are discovered from the filesystem, not settings.json
OMP v17.3.5 stores skills at:
1. `~/.omp/agent/managed-skills/<name>/SKILL.md` — global managed skills
2. `<cwd>/.agents/skills/<name>/SKILL.md` — project skills

`skills-service.ts` discovers these directly. No configured skill paths (settings.json)
are read.

### Plugins go through the `omp plugin` CLI
`/api/plugins` shells out to `omp plugin list --json` (read) and `omp plugin
install/remove/enable/disable` (write). The `update` action is `feature_unavailable`
because `omp plugin upgrade` can require interactive prompts.

### Session files can be fully rewritten
`parentSession` in the header is **display metadata only** — zero effect on chat content.
Safe to `writeFileSync` the entire file (OMP does this during migrations). Used when
cascade-reparenting children on delete.

### Two kinds of branching — don't confuse them
- **Fork** (Fork button on user message): creates a new independent `.jsonl` file. In OMP
  RPC mode, forking **at a specific entry** is `capability_unavailable`; a whole-session
  fork via `parentSession` is the supported path.
- **In-session branch** (Continue button / BranchNavigator): calls `branch` (OMP RPC) within
  the same file. Multiple entries share the same `parentId`; switching between them calls
  `/api/sessions/[id]/context?leafId=`.

### ToolCall field normalization
OMP stores toolCall blocks as `{type:"toolCall", id, name, arguments}` but `ToolCallContent`
uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/normalize.ts` handles
this — called in both `session-reader.ts` (file load) and `ChatWindow.handleAgentEvent()`
(streaming).

### Tool filtering is not enforced
`POST /api/agent/new` accepts `toolNames[]` for pi-web compatibility but returns
`capability_unavailable` with `feature: "tool_filtering"`. The UI must not claim a
tool guardrail is active when OMP RPC cannot enforce it.

### SSE reconnect on page refresh mid-stream
On `ChatWindow` mount, `GET /api/agent/[id]` is called. If `state.isStreaming === true`,
SSE is reconnected automatically. `thinkingLevel` and `isCompacting` are also synced from
this response.

### Compaction SSE events
OMP emits `compaction_start` / `compaction_end`; older versions emitted
`auto_compaction_start` / `auto_compaction_end`. `handleAgentEvent` accepts both sets to
keep `isCompacting` in sync. Manual compact is a blocking POST — the button stays disabled
until the response returns.

### Running state polling + reconciliation
- The sidebar polls `/api/agent/running` every 2.5 seconds while the tab is visible and
  pauses in background tabs. The session-list response remains the initial fallback.
- `useAgentSession` treats per-session SSE as primary for chat events and opens it before
  each prompt. `prompt_done` completes the current UI stage and notification immediately,
  but the idle SSE stays open for a 30-second grace window and is reused by the next
  prompt. `agent_start` cancels that close timer; `agent_settled` finishes
  extension-injected runs that have no wrapper-level `prompt_done`. Do not close on the
  first `agent_end`: retries, compaction, and extension-queued messages can continue the
  same logical prompt.
- While a run is active, `useAgentSession` periodically calls `GET /api/agent/[id]` and
  reconciles on `visibilitychange`/`online`. This fixes missed terminal events from
  background tabs or half-open connections.
- Prompt runs use a monotonic run id; late SSE or slow reconciliation responses from an
  old run must be ignored so they cannot resurrect stale streaming bubbles.

### Worktrees and project grouping
- `lib/worktree.ts` resolves linked worktree top-levels back to the main repo
  `projectRoot`; `listAllSessions()` attaches that to each `SessionInfo` so all worktrees
  for one repo are grouped together in the sidebar.
- Worktree operations are served by `/api/worktrees` and guarded by the same allowed-root
  rules as `/api/files`.
- Removing a dirty worktree returns `409` with `{ dirty: true }` so the UI can ask before
  retrying with `force`.
- git prints POSIX-style absolute paths even on Windows, so every path read out of git goes
  through `toNativePath()` (`lib/paths.ts`) before it is compared or returned. Compare
  paths with `samePath()`, never `===`. Branch names are not paths and must keep their
  forward slashes.

### File access allow-list
- `/api/files` is intentionally not a general filesystem browser. Allowed roots come from
  session cwds, their resolved project roots, and roots explicitly added with
  `allowFileRoot()`.
- Allowed roots are stored slash-normalized, but that is a Set-key convention, not a
  correctness requirement: `isPathWithinRoots()` (`lib/path-security.ts`, the single
  implementation behind `isFilePathAllowed()`) re-resolves and case-folds both sides.
  Keep that one implementation — it is the security boundary.

### Security gates
- HTTP Basic Auth is enabled by `OMP_WEB_PASSWORD` (username `omp`).
- Host/origin allow-listing is enforced by `lib/request-security.ts` plus
  `OMP_WEB_ALLOWED_HOSTS`.
- Credentials, API keys, tokens, and sensitive fields from OMP credential storage MUST
  NOT be read or echoed. `models.yaml` parsing strips keys before they reach the client.

---

## OMP Session File Format

Location: `~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"...","modelId":"...","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`entryIds[]` in `SessionContext` is a parallel array to `messages[]` — maps each displayed
message back to its `.jsonl` entry id, used for branch/navigate calls.

---

## CSS Variables (`app/globals.css`)

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --user-bg --tool-bg
--font-mono

Semantic (text / -border / -bg variants, dark overrides in html.dark):
--success --warning --error --info

Radius scale: --radius-xs 4 · --radius-sm 6 · --radius-md 8 · --radius-lg 12 · --radius-xl 14
  xs chips/badges · sm controls · md cards · lg modals · xl hero surfaces
Spacing (4pt, new components consume these): --space-1..8
Elevation: --shadow-menu · --shadow-menu-up (opens upward) · --shadow-modal · --shadow-pop

Rule: never hardcode status colors (#ef4444, #4ade80, rgba(234,179,8,…), …) in components —
use the semantic tokens so dark mode stays correct.
```
