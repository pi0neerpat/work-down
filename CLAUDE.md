# Scribular Coordination Hub

Coordination hub for the Scribular project -- a privacy-first, on-device AI note-taking tool for therapists. This repo aggregates status, tasks, activity, and swarm agent progress across 4 repos.

## Repos

Defined in `config.json` (source of truth for all repo paths):

| Name | Path | Description |
|------|------|-------------|
| marketing | `../marketing-dept-scribular` | Marketing content, social media, outreach |
| website | `../scribular-saas-project` | scribular.com website |
| electron | `../notes-assistant-electron` | Desktop Electron app |
| hub | `.` (this repo) | Coordination hub: CLI, terminal dashboard, web dashboard |

Every repo tracks tasks in `todo.md` and activity in `activity-log.md`.

## Architecture

```
config.json ─── loadConfig() ───┐
                                │
                          parsers.js (shared)
                           │    │    │
                    ┌──────┘    │    └──────┐
                    v           v           v
                 cli.js    terminal.js   dashboard/server.js
              (JSON out)   (ANSI out)    (Express REST API)
                                              │
                                         dashboard/src/
                                        (React + Tailwind SPA)
```

`parsers.js` is the shared data layer. Changes to it affect the CLI, terminal dashboard, AND web dashboard.

## Key Files

- **config.json** -- Repo definitions (names, relative paths, task/activity file names). Has `hubRoot` for absolute resolution.
- **parsers.js** -- CommonJS module. Read functions: `parseTaskFile`, `parseActivityLog`, `getGitInfo`, `parseSwarmFile`, `parseSwarmDir`, `loadConfig`. Write functions: `writeTaskDone`, `writeTaskAdd`, `writeTaskMove`, `writeSwarmValidation`, `writeSwarmKill`, `writeSwarmStatus`, `createCheckpoint`, `revertCheckpoint`, `dismissCheckpoint`, `listCheckpoints`. Zero external dependencies.
- **cli.js** -- Agent-friendly CLI. All output is JSON to stdout, errors as JSON to stderr. Commands: `status`, `tasks [--repo=name]`, `swarm [id]`, `repos`, `activity [--limit=N]`, `config`.
- **terminal.js** -- Human-friendly ANSI terminal dashboard. Read-only display, no interactivity. Uses box-drawing characters.
- **todo.md** -- Hub's own task tracker (markdown checkboxes).
- **activity-log.md** -- Hub's own activity log. Contains `**Current stage:**` metadata.
- **notes/swarm/** -- Swarm sub-agent progress files. Named `YYYY-MM-DD-slug.md`.

### Dashboard (`dashboard/`)

Separate Node.js project with its own `package.json` (ESM, `"type": "module"`).

- **server.js** -- Express backend on port 3001. Imports `../parsers.js` via `createRequire`. Serves REST API (`/api/overview`, `/api/swarm`, `/api/swarm/:id`, `/api/config`, `/api/tasks/*`, `/api/sessions`) and WebSocket terminal server (`/ws/terminal`) with persistent PTY sessions. Serves built SPA from `dist/`.
- **src/** -- React SPA with Tailwind CSS v4. Components: `HeaderBar`, `Sidebar`, `CenterTabs`, `TaskBoard`, `TerminalPanel`, `ResultsPanel`, `RightPanel`, `SwarmDetail`, `SwarmPanel`, `RepoStatus`, `ActivityTimeline`. Hooks: `usePolling`, `useTerminal`. See `docs/dashboard-architecture.md` for full component tree and data flow.
- **vite.config.js** -- Proxies `/api` and `/ws` to `localhost:3001` during dev.

### Clauffice (`clauffice/`)

Git submodule -- the "Clauffice" business OS for Claude Code. Contains skills, agents, hooks, references, and commands.

- **install.sh** -- Symlinks `clauffice/dot-claude/` contents into `.claude/` (skills, hooks, references, agents, commands). Merges `settings.json` hooks. Appends to `.claudeignore`.
- The `.claude/` directory at repo root is a **generated artifact** of `clauffice/install.sh`. Its subdirectories are symlinks into `clauffice/dot-claude/`.

## Running Things

```bash
# CLI (no install needed, zero dependencies)
node cli.js status
node cli.js tasks --repo=electron
node cli.js swarm
node cli.js swarm 2026-03-11-some-task

# Terminal dashboard (no install needed)
node terminal.js

# Web dashboard (requires npm install in dashboard/)
cd dashboard && npm install
npm run dev          # Vite dev server + Express API (concurrently)
npm run dev:server   # Express API only (port 3001)
npm run dev:client   # Vite only (proxies /api to 3001)
npm run build        # Production build to dashboard/dist/
npm start            # Serve built SPA + API from port 3001
```

## Conventions

- **Root-level JS**: CommonJS (`require`/`module.exports`), plain Node.js, zero external dependencies.
- **Dashboard JS**: ESM (`import`/`export`), React JSX, Tailwind CSS. External deps managed via `dashboard/package.json`.
- **CLI output**: Always JSON. Designed for agent consumption. Human output goes through `terminal.js`.
- **Task format**: Markdown checkboxes (`- [ ]` / `- [x]`) under `##` section headers in `todo.md`.
- **Activity format**: Date headers (`## YYYY-MM-DD`) with bullet entries in `activity-log.md`.
- **Swarm file format**: Markdown in `notes/swarm/YYYY-MM-DD-slug.md` with frontmatter-style metadata (`# Swarm Task:`, `Started:`, `Status:`, `Validation:`), then `## Progress`, `## Results`, `## Validation` sections.

## Documentation

Detailed architecture docs live in `docs/`. Read these before making structural changes:

| Doc | What It Covers |
|-----|----------------|
| `docs/coding-standards.md` | Style guide, naming, data contracts, theming |
| `docs/cli-architecture.md` | parsers.js function map, CLI commands, terminal.js structure, data flow, task numbering, known duplication |
| `docs/dashboard-architecture.md` | Server endpoints, React component tree, hooks, dependencies, session lifecycle, ID mapping (session vs swarm file) |

## Rules

1. **`.claude/` is READ-ONLY.** Its contents are symlinks from `clauffice/dot-claude/`. To change skills, hooks, agents, etc., edit inside `clauffice/dot-claude/` and run `./clauffice/install.sh`.
2. **`config.json` is the source of truth** for repo paths and file locations. Do not hardcode repo paths elsewhere.
3. **`parsers.js` is shared infrastructure.** Test changes against all three consumers (cli.js, terminal.js, dashboard/server.js) before committing.
4. **Swarm progress files** go in `notes/swarm/YYYY-MM-DD-slug.md` with the standard format (see Conventions above).
5. **All repos use the same task/activity pattern**: `todo.md` for tasks, `activity-log.md` for activity.
6. **No TypeScript** in root-level files. The dashboard uses JSX but not TypeScript.
7. **No external dependencies** for root-level files (parsers.js, cli.js, terminal.js). The dashboard has its own dependency tree.
