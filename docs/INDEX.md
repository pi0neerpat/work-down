# Document Index

> Agent reference — maps topics to files in this repo.

## Project Context

| Topic | File | Summary |
|-------|------|---------|
| Project overview | `CLAUDE.md` | Coordination hub architecture, repos, key files, conventions, and running instructions |
| Repo definitions | `config.json` | Defines 4 repos (marketing, website, electron, hub) with paths and task/activity file names |

## Architecture

| Topic | File | Summary |
|-------|------|---------|
| CLI & parsers | `docs/cli-architecture.md` | parsers.js job/swarm compatibility exports, cli.js command map, terminal.js structure, task numbering, and data flow |
| Web dashboard | `docs/dashboard-architecture.md` | Express endpoints for jobs/sessions/schedules, runtime state in `.hub-runtime/`, React views, hooks, PTY lifecycle, and Claude resume flow |

## Agent Integration

| Topic | File | Summary |
|-------|------|---------|
| Server API reference | `docs/agent-api.md` | All REST endpoints on port 3747 — optional `DISPATCH_API_KEY` / `DISPATCH_BIND`, `GET /api/catalog`, jobs, tasks, bugs, plans, checkpoints, schedules, and the hook callback used by `hub-stop.js`. Includes dispatch field reference and injected env vars. |
| Dispatch API quick reference | `docs/dispatch-api-quickref.md` | Minimal handoff for external orchestrators: auth, catalog, dispatch, polling, lifecycle — points to `agent-api.md` for full detail. |

## Standards

| Topic | File | Summary |
|-------|------|---------|
| Coding standards | `docs/coding-standards.md` | Style guide covering JS conventions, `notes/jobs` file contracts, API naming/alias policy, runtime state files, and CSS theming |
