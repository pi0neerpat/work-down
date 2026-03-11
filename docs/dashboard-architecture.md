# Dashboard Architecture

Code map for the web dashboard: Express backend + React SPA.

---

## Project Structure

```
dashboard/
├── server.js              # Express API + WebSocket terminal server (ESM)
├── package.json           # Dependencies (Yarn 4, nodeLinker: node-modules)
├── .yarnrc.yml            # Yarn config
├── vite.config.js         # Vite build config (React + Tailwind + API proxy)
├── index.html             # SPA shell
└── src/
    ├── main.jsx           # Entry point — mounts <App /> with StrictMode
    ├── App.jsx            # Root component — state, routing, data fetching
    ├── components/
    │   ├── HeaderBar.jsx      # Top bar: title, agent badges, permissions toggle
    │   ├── Sidebar.jsx        # Left nav: repo list + worker bee list
    │   ├── CenterTabs.jsx     # Tab container (generic)
    │   ├── TaskBoard.jsx      # Task list with done/add/move/start actions
    │   ├── TerminalPanel.jsx  # Terminal instances (one per worker)
    │   ├── ResultsPanel.jsx   # Review tab: agent results + validate/reject
    │   ├── RightPanel.jsx     # Right sidebar: progress timeline or activity feed
    │   ├── SwarmDetail.jsx    # Full-page agent detail (legacy, provides statusConfig)
    │   ├── SwarmPanel.jsx     # Grid of agent cards (standalone view)
    │   ├── ActivityTimeline.jsx # Standalone activity timeline
    │   └── RepoStatus.jsx     # Repo cards with progress rings + checkpoints
    ├── lib/
    │   ├── usePolling.js      # Hook: poll API endpoint at interval
    │   ├── useTerminal.js     # Hook: xterm.js + WebSocket PTY connection
    │   └── utils.js           # cn() class merger + timeAgo() formatter
    └── styles/
        ├── tailwind.css       # Tailwind v4 import + source config
        └── theme.css          # CSS custom properties (colors, fonts, animations)
```

---

## Dependencies

### Runtime (production)

| Package | Version | Used By | Purpose |
|---------|---------|---------|---------|
| `express` | ^4.21 | server.js | REST API server |
| `cors` | ^2.8 | server.js | CORS middleware for dev |
| `ws` | ^8.18 | server.js | WebSocket server for terminal |
| `node-pty` | ^1.0 | server.js | PTY process spawning (zsh terminals) |
| `react` | ^18.3 | src/ | UI framework |
| `react-dom` | ^18.3 | src/ | React DOM renderer |
| `@xterm/xterm` | ^5.5 | useTerminal.js | Terminal emulator widget |
| `@xterm/addon-fit` | ^0.10 | useTerminal.js | Auto-resize terminal to container |
| `@xterm/addon-web-links` | ^0.11 | useTerminal.js | Clickable URLs in terminal |
| `lucide-react` | 0.487 | components/ | Icon library (tree-shakeable) |
| `react-markdown` | ^10.1 | ResultsPanel, SwarmDetail, SwarmPanel | Render markdown in results/validation |
| `clsx` | 2.1 | utils.js | Conditional class name joining |
| `tailwind-merge` | 3.2 | utils.js | Merge conflicting Tailwind classes |

### Dev

| Package | Purpose |
|---------|---------|
| `vite` | Build tool + dev server |
| `@vitejs/plugin-react` | JSX transform |
| `tailwindcss` + `@tailwindcss/vite` | Tailwind CSS v4 |
| `concurrently` | Run server + vite in parallel during dev |

---

## Server (server.js)

ESM module. Bridges to `parsers.js` (CommonJS) via `createRequire`.

### REST API Endpoints

#### Read Endpoints

| Endpoint | Handler | parsers.js Functions Used |
|----------|---------|--------------------------|
| `GET /api/config` | Inline | `loadConfig` |
| `GET /api/overview` | Inline | `parseTaskFile`, `parseActivityLog`, `getGitInfo`, `listCheckpoints` |
| `GET /api/swarm` | Inline | `parseSwarmDir` |
| `GET /api/swarm/:id` | Inline | `parseSwarmFile` |
| `GET /api/activity` | Inline | `parseActivityLog` |
| `GET /api/sessions` | Inline | Reads from `ptySessions` Map |

#### Write Endpoints

| Endpoint | parsers.js Function | What It Does |
|----------|---------------------|--------------|
| `POST /api/swarm/init` | None (direct `fs.writeFileSync`) | Creates swarm file from task text |
| `POST /api/tasks/done` | `writeTaskDone` | Mark open task as done |
| `POST /api/tasks/add` | `writeTaskAdd` | Add new task to todo.md |
| `POST /api/tasks/move` | `writeTaskMove` | Move task between repos |
| `POST /api/swarm/:id/validate` | `writeSwarmValidation` | Set validation to "validated" |
| `POST /api/swarm/:id/reject` | `writeSwarmValidation` | Set validation to "rejected" |
| `POST /api/swarm/:id/kill` | `writeSwarmKill` | Mark agent as killed |

#### Checkpoint Endpoints

| Endpoint | parsers.js Function |
|----------|---------------------|
| `POST /api/repos/:name/checkpoint` | `createCheckpoint` |
| `GET /api/repos/:name/checkpoints` | `listCheckpoints` |
| `POST /api/repos/:name/checkpoint/:id/revert` | `revertCheckpoint` |
| `DELETE /api/repos/:name/checkpoint/:id` | `dismissCheckpoint` |

### WebSocket Terminal Server

Path: `/ws/terminal`

**Query parameters:**
- `repo` — Repo name (resolves cwd)
- `session` — Session ID for reconnect
- `swarmFile` — Absolute path to swarm file (for completion tracking)

**Protocol:**
- Client → Server: raw keystrokes, or `\x01RESIZE:cols,rows`
- Server → Client: raw terminal output, or `\x01SESSION:id` (on new session)

**Session persistence:** PTY sessions survive WebSocket disconnects. The `ptySessions` Map holds `{ shell, repo, cwd, scrollback, alive, swarmFilePath }`. On reconnect, scrollback is replayed. On shell exit, if the session has a `swarmFilePath` with `in_progress` status, it's auto-updated to `completed`.

---

## React Component Tree

```
App (root state: selection, agentTerminals, skipPermissions)
├── HeaderBar (overview, swarm, permissions toggle)
├── Sidebar (repo list, worker bee list, selection handler)
├── CenterTabs (tab bar + content)
│   ├── [repo view] TaskBoard (tasks per repo, add/done/move/start)
│   ├── [swarm view] TerminalPanel → TerminalInstance (per session)
│   └── [swarm view] ResultsPanel (agent detail + validate/reject)
└── RightPanel (collapsible)
    ├── [repo view] ActivityFeed (recent cross-repo activity)
    └── [swarm view] ProgressTimeline (agent progress entries)
```

### Component Responsibilities

| Component | Data Source | Write Actions | Key Props |
|-----------|------------|---------------|-----------|
| **App** | `usePolling('/api/overview')`, `usePolling('/api/swarm')`, localStorage | Manages `agentTerminals` Map, session persistence | — |
| **HeaderBar** | Props from App | Toggle `skipPermissions` | `overview`, `swarm`, `skipPermissions` |
| **Sidebar** | Props from App | Selection changes | `overview`, `swarm`, `selection`, `activeWorkers` |
| **CenterTabs** | Generic | Tab switching | `tabs`, `activeTab`, `contentMap` |
| **TaskBoard** | Props (`overview`) | `POST /api/tasks/done`, `POST /api/tasks/add`, `POST /api/tasks/move` | `overview`, `selectedRepo`, `onStartTask` |
| **TerminalPanel** | `agentTerminals` Map | Kill session, update session ID, prompt sent | `sessions`, `activeSessionId`, `skipPermissions` |
| **ResultsPanel** | `GET /api/swarm/:id` (on mount) | `POST /api/swarm/:id/validate`, `/reject`, `/kill` | `agentId` |
| **RightPanel** | `GET /api/swarm/:id` (polling) or `GET /api/activity` | — | `selection`, `swarmFileId` |

### Shared Patterns Across Components

**Repo identity colors** — Used in 6+ components for color-coding repos:
```js
const repoIdentityColors = {
  marketing: '#e0b44a',
  website: '#818cf8',  // or '#7b8af5' in some files
  electron: '#34d399', // or '#34c9a0'
  hub: '#7dd3fc',      // or '#6ba8e8'
}
```
This is duplicated across `Sidebar.jsx`, `TaskBoard.jsx`, `RightPanel.jsx`, `ResultsPanel.jsx`, `RepoStatus.jsx`, and `SwarmPanel.jsx`. If you need to change a color, update **all** instances. Consider extracting to a shared constant if this becomes error-prone.

**Status config** — Exported from `SwarmDetail.jsx` as `statusConfig`, imported by `RightPanel.jsx` and `ResultsPanel.jsx`:
```js
import { statusConfig } from './SwarmDetail'
```
Maps status strings (`in_progress`, `completed`, `failed`, `killed`) to `{ icon, color, bg, label, dotColor }`.

**Markdown rendering** — `ResultsPanel` and `SwarmDetail` both define `mdComponents` for custom react-markdown styling. These are similar but not shared.

**Confirmation pattern** — Kill and revert actions use a 2-click confirm with 3-second timeout:
```js
if (confirmKill) { /* execute */ }
else { setConfirmKill(true); setTimeout(() => setConfirmKill(false), 3000) }
```

---

## Custom Hooks

### usePolling(url, intervalMs)

```js
const { data, loading, error, lastRefresh, refresh } = usePolling('/api/overview', 10000)
```

- Fetches URL on mount and every `intervalMs` ms
- Returns parsed JSON as `data`
- `refresh()` triggers an immediate re-fetch
- Uses `AbortController` for cleanup
- All API data flows through this hook (overview at 10s, swarm at 5s)

### useTerminal({ onConnected, onIncomingData, repo, sessionId, onSessionId, swarmFilePath })

```js
const { termRef, isConnected, sendCommand, sendRaw, reconnect } = useTerminal({ ... })
```

- Creates xterm.js terminal and WebSocket connection
- `termRef` — attach to a DOM element via `ref={termRef}`
- `sendCommand(text)` — sends text + Enter
- `sendRaw(data)` — sends raw bytes
- `reconnect({ reattach })` — reconnects; if `reattach: true`, skips `onConnected` callback
- Handles container resize via `ResizeObserver` → `FitAddon`
- Passes `session`, `repo`, `swarmFile` as WebSocket query params

---

## ID Mapping: Sessions vs Swarm Files

A key architectural detail: the dashboard uses **two ID spaces** for swarm agents.

| ID Type | Format | Where Used |
|---------|--------|------------|
| Client session ID | `session-1710000000` | `agentTerminals` Map keys, `selection.id` |
| Swarm file ID | `2026-03-11-slug` | API endpoints (`/api/swarm/:id`), sidebar agent list |

The `agentTerminals` Map bridges these: each entry stores `{ swarmFile: { fileName, relativePath, absolutePath } }`. App.jsx derives `swarmFileId` by stripping `.md` from `fileName`:

```js
const swarmFileId = agentTerminals.get(selection.id)?.swarmFile?.fileName?.replace(/\.md$/, '')
```

This `swarmFileId` is passed to `RightPanel` (for `ProgressTimeline`) and used as `reviewAgentId` (for `ResultsPanel`). Without this mapping, the progress timeline and review tab would try to fetch `/api/swarm/session-1710000000` which doesn't exist.

---

## Terminal Session Lifecycle

1. User clicks "Start" on a task in TaskBoard
2. `App.handleStartTask` → `POST /api/swarm/init` (creates swarm file) → adds to `agentTerminals` Map
3. `TerminalPanel` renders a `TerminalInstance` for the session
4. `useTerminal` opens WebSocket to `/ws/terminal?repo=name&swarmFile=path`
5. Server spawns PTY (`/bin/zsh --login`) in repo directory, returns `\x01SESSION:id`
6. `onConnected` fires → sends `claude --dangerously-skip-permissions` command
7. Terminal output watcher detects Claude's `❯` prompt → sends `/swarm <task text>`
8. `onPromptSent` callback persists `promptSent: true` in `agentTerminals` (survives tab switch/refresh)
9. When PTY shell exits, server checks swarm file — if `in_progress`, marks as `completed`
10. Client's `/api/swarm` polling picks up the status change within 5 seconds

---

## Vite Configuration

- **React plugin**: `@vitejs/plugin-react` for JSX
- **Tailwind plugin**: `@tailwindcss/vite` for CSS processing
- **Dev server proxy**: `/api` → `http://localhost:3001`, `/ws` → `ws://localhost:3001`
- **Build output**: `dashboard/dist/` (served by Express in production)
