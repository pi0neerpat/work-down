AGENT_CRIBS_SLUG: scribular

# Claude Agent Hub

A multi-repo coordination hub for Claude Code agent workflows. Aggregates tasks, activity, and agent job progress across multiple repos. Includes a CLI, terminal dashboard, and web dashboard.

## Repos

Defined in `config.json` (source of truth for all repo paths). Edit this to point to your repos.

| Field | Description |
|-------|-------------|
| `name` | Short name used in CLI output and dashboard |
| `path` | Relative path from hub root to the repo |
| `taskFile` | Markdown file for tasks (default: `todo.md`) |
| `bugsFile` | Markdown file for bugs (default: `bugs.md`) |
| `activityFile` | Markdown file for activity (default: `activity-log.md`) |
| `startScript` | Command to start the repo's dev server |
| `testScript` | Command to run tests |
| `cleanupScript` | Command to clean build artifacts |

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

- **config.json** -- Repo definitions. `hubRoot` (display path) and `monthlyBudget` (optional) are user-specific; set `hubRoot` to your local hub path (e.g. `.` for current dir). Server falls back to `HUB_DIR` env var when `hubRoot` is unset.
- **parsers.js** -- CommonJS module. Primary job APIs: `parseJobFile`, `parseJobDir`, `writeJobValidation`, `writeJobKill`, `writeJobStatus`. Also owns task/activity parsing, task writes, and checkpoint helpers. Zero external dependencies.
- **cli.js** -- Agent-friendly CLI. All output is JSON to stdout, errors as JSON to stderr. Commands: `status`, `tasks [--repo=name]`, `swarm [id]`, `repos`, `activity [--limit=N]`, `config`.
- **terminal.js** -- Human-friendly ANSI terminal dashboard. Read-only display, no interactivity. Uses box-drawing characters.
- **todo.md** -- Hub's own task tracker (markdown checkboxes).
- **activity-log.md** -- Hub's own activity log. Contains `**Current stage:**` metadata.
- **notes/jobs/** -- Job progress files (gitignored — runtime artifacts). Named `YYYY-MM-DD-slug.md`.
- **.hub-runtime/** -- Server runtime state (gitignored): `.hub-runtime/job-runs.json` for job run state, `.hub-runtime/prompts/` for staged Claude prompts, `.hub-runtime/events/` for terminal event snapshots/NDJSON.

### Dashboard (`dashboard/`)

Separate Node.js project with its own `package.json` (ESM, `"type": "module"`).

- **server.js** -- Express backend on port 3001. Imports `../parsers.js` via `createRequire`. REST API for overview, tasks, bugs, jobs (`/api/jobs`), sessions, schedules, checkpoints, and events. WebSocket terminal server (`/ws/terminal`) keeps PTY sessions alive across reconnects, stages server-managed Claude launches/resumes, persists run state in `.hub-runtime/job-runs.json`.
- **eventPipeline.js** -- Captures terminal output into structured NDJSON events. Line classification, agent detection, event search, session summaries.
- **src/** -- React SPA with Tailwind CSS v4. Navigation: `ActivityBar` (icon tabs) → views (`StatusView`, `JobsView`, `AllTasksView`, `DispatchView`, `SchedulesView`) with `JobDetailView` drill-down. Hooks: `usePolling`, `useSessionStore`, `useTerminal`, `useSearch`.
- **vite.config.js** -- Proxies `/api` and `/ws` to `localhost:3001` during dev.

### Claude Skills (`.claude/`)

Project-specific skills and hooks committed to this repo:

- **`dot-claude/skills/workdown/`** -- Cross-repo task view and work prioritization.
- **`dot-claude/skills/done/`** -- Mark a task done and log activity.
- **`dot-claude/skills/add-repo/`** -- Connect a new repo to Work.Down.
- **`dot-claude/hooks/protect-env.js`** -- Blocks Claude from reading/editing `.env` files.
- **`dot-claude/hooks/hub-stop.js`** -- Signals the dashboard when a dispatched Claude session ends.

## Running Things

```bash
# CLI (no install needed, zero dependencies)
node cli.js status
node cli.js tasks --repo=app
node cli.js swarm
node cli.js swarm 2026-03-11-some-task

# Terminal dashboard (no install needed)
node terminal.js

# Web dashboard (requires yarn install in dashboard/)
cd dashboard && yarn install
yarn dev             # Vite dev server + Express API (concurrently)
yarn dev:server      # Express API only (port 3001)
yarn dev:client      # Vite only (proxies /api to 3001)
yarn build           # Production build to dashboard/dist/
yarn start           # Serve built SPA + API from port 3001
```

## Conventions

- **Root-level JS**: CommonJS (`require`/`module.exports`), plain Node.js, zero external dependencies.
- **Dashboard JS**: ESM (`import`/`export`), React JSX, Tailwind CSS. External deps managed via `dashboard/package.json`.
- **CLI output**: Always JSON. Designed for agent consumption. Human output goes through `terminal.js`.
- **Task format**: Markdown checkboxes (`- [ ]` / `- [x]`) under `##` section headers in `todo.md`.
- **Activity format**: Date headers (`## YYYY-MM-DD`) with bullet entries in `activity-log.md`.
- **Job file format**: Markdown in `notes/jobs/YYYY-MM-DD-slug.md` with line-based metadata: `# Job Task:`, `Started:`, `Status:`, `Validation:`, `Session:`, optional `SkipPermissions:`, `ResumeId:`, `ResumeCommand:`, followed by `## Progress`, `## Results`, and `## Validation` sections.

## Documentation

| Doc | What It Covers |
|-----|----------------|
| `docs/coding-standards.md` | Style guide, naming, data contracts, theming |
| `docs/cli-architecture.md` | parsers.js function map, CLI commands, terminal.js structure, data flow |
| `docs/dashboard-architecture.md` | Server endpoints, React component tree, hooks, dependencies, session lifecycle |

## Rules

1. **`config.json` is the source of truth** for repo paths and file locations. Do not hardcode repo paths elsewhere.
2. **`parsers.js` is shared infrastructure.** Test changes against all three consumers (cli.js, terminal.js, dashboard/server.js) before committing.
3. **Job progress files** go in `notes/jobs/YYYY-MM-DD-slug.md` with the standard format (see Conventions above).
4. **All repos use the same task/activity pattern**: `todo.md` for tasks, `activity-log.md` for activity.
5. **No TypeScript** in root-level files. The dashboard uses JSX but not TypeScript.
6. **No external dependencies** for root-level files (parsers.js, cli.js, terminal.js). The dashboard has its own dependency tree.
