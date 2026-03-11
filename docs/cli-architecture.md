# CLI Architecture

Code map for the hub's command-line interfaces: `cli.js` and `terminal.js`.

---

## File Overview

| File | Purpose | Module | Dependencies |
|------|---------|--------|--------------|
| `parsers.js` | Shared data layer — all reading and writing | CommonJS | `fs`, `path`, `child_process` (Node built-ins only) |
| `cli.js` | Agent-friendly CLI (JSON to stdout) | CommonJS | `parsers.js`, `fs`, `path` |
| `terminal.js` | Human-friendly ANSI dashboard | CommonJS | `parsers.js`, `fs`, `path` |
| `config.json` | Repo registry (names, paths, file locations) | JSON | — |

All three JS files have **zero npm dependencies**. They run with a bare `node` install.

---

## parsers.js — Shared Data Layer

Every consumer (CLI, terminal, dashboard server) imports from `parsers.js`. This is the **only** place data is parsed or written.

### Read Functions

| Function | Input | Output | What It Parses |
|----------|-------|--------|----------------|
| `loadConfig(hubDir)` | Hub root path | `{ repos: [{ name, path, resolvedPath, taskFile, activityFile }] }` | `config.json` — resolves relative repo paths to absolute |
| `parseTaskFile(filePath)` | Path to `todo.md` | `{ sections: [{ name, tasks: [{ text, done }] }], openCount, doneCount }` | Markdown `## Section` headers + `- [ ]`/`- [x]` checkboxes |
| `parseActivityLog(filePath)` | Path to `activity-log.md` | `{ stage, entries: [{ date, bullet }] }` | `**Current stage:**` line + `## YYYY-MM-DD` headers + first bullet per date |
| `getGitInfo(repoPath)` | Repo directory path | `{ branch, dirtyCount }` | `git branch --show-current` + `git status --porcelain` |
| `parseSwarmFile(filePath)` | Path to swarm `.md` file | `{ id, taskName, started, status, validation, progressEntries, results, ... }` | Swarm file header metadata + `## Progress`, `## Results`, `## Validation` sections |
| `parseSwarmDir(dirPath)` | Path to `notes/swarm/` dir | `[parseSwarmFile result, ...]` | All `.md` files in the directory |

### Write Functions

| Function | What It Does | File Modified |
|----------|--------------|---------------|
| `writeTaskDone(filePath, taskNum)` | Replaces `[ ]` with `[x]` on the Nth open task | `todo.md` |
| `writeTaskAdd(filePath, text, section)` | Inserts a `- [ ]` line after the last task in a section | `todo.md` |
| `writeTaskMove(sourceFile, taskNum, destFile, section)` | Removes task from source, adds to destination | Two `todo.md` files |
| `writeSwarmValidation(filePath, status, notes)` | Sets `Validation:` line, appends `## Validation Notes` | Swarm `.md` file |
| `writeSwarmKill(filePath)` | Sets `Status: Killed`, writes `.kill` marker file | Swarm `.md` file |
| `writeSwarmStatus(filePath, newStatus)` | Updates the `Status:` line to a new value | Swarm `.md` file |
| `createCheckpoint(repoPath)` | Creates a git branch capturing current working directory | Git (new branch) |
| `revertCheckpoint(repoPath, id)` | Restores working directory from checkpoint branch | Git (checkout + delete branch) |
| `dismissCheckpoint(repoPath, id)` | Deletes checkpoint branch, keeps current state | Git (delete branch) |
| `listCheckpoints(repoPath)` | Lists `checkpoint/*` branches with metadata | Git (read-only) |

### Task Numbering Convention

`writeTaskDone` and `writeTaskAdd` both count tasks the same way:
- Iterate all lines in file order
- Match `^(\d+\.\s+|[-*]\s+)\[ \]\s+(.+)` (open tasks only)
- Increment a 1-based counter for each match
- `taskNum` refers to the Nth match

The TaskBoard UI uses the same counting, iterating sections in file order and only counting open tasks.

---

## cli.js — Agent CLI

JSON-only interface designed for consumption by Claude Code and other agents.

### Command Router

```
node cli.js <command> [subcommand] [positionals] [--flags]
```

| Command | Subcommand | What It Does |
|---------|------------|--------------|
| `status` | — | Full overview: stage, repos, tasks, git status, swarm summary |
| `tasks` | — | Open tasks across repos. `--repo=name` to filter |
| `tasks` | `done` | `tasks done <repo> <num>` — mark task as done |
| `tasks` | `add` | `tasks add <repo> "text"` — add task. `--section=name` optional |
| `swarm` | — | All swarm agents with summary counts |
| `swarm` | `<id>` | Single agent detail (progress, results, validation) |
| `swarm` | `validate` | `swarm validate <id>` — mark as validated |
| `swarm` | `reject` | `swarm reject <id> --notes="reason"` |
| `repos` | — | Git status (branch, dirty count) for all repos |
| `activity` | — | Recent activity entries. `--limit=N` |
| `config` | — | Raw config.json contents |
| `checkpoint` | `create` | `checkpoint create <repo>` |
| `checkpoint` | `revert` | `checkpoint revert <repo> <id>` |
| `checkpoint` | `dismiss` | `checkpoint dismiss <repo> <id>` |
| `checkpoint` | `list` | `checkpoint list [--repo=name]` |

### Output Contract

- **Success**: JSON to stdout via `process.stdout.write(JSON.stringify(obj, null, 2) + '\n')`
- **Error**: JSON to stderr via `process.stderr.write(JSON.stringify({ error: msg }) + '\n')`, exit code 1

### Internal Structure

```
cli.js
├── Arg parser (flags, positionals, subcommand detection)
├── Config loader (loadConfig)
├── Data gatherers
│   ├── gatherRepos()  — calls parseTaskFile, parseActivityLog, getGitInfo per repo
│   └── gatherSwarm()  — calls parseSwarmDir per repo, tags with repo name
├── Read commands (cmdStatus, cmdTasks, cmdSwarm, cmdRepos, cmdActivity, cmdConfig)
├── Write commands (cmdTasksDone, cmdTasksAdd, cmdSwarmValidate, cmdSwarmReject)
├── Checkpoint commands (cmdCheckpointCreate, cmdCheckpointRevert, cmdCheckpointDismiss, cmdCheckpointList)
└── Router (route function — maps command+subcommand to handler)
```

---

## terminal.js — ANSI Dashboard

Read-only, non-interactive terminal display using box-drawing characters.

### How It Differs From cli.js

| Aspect | cli.js | terminal.js |
|--------|--------|-------------|
| Output format | JSON | ANSI-colored box art |
| Audience | Agents / scripts | Humans |
| Interactivity | None | None |
| Activity parsing | Uses `parseActivityLog` from parsers.js | Has its own `parseActivityLogTerminal` (formats dates as "Mar 10") |

### Duplication Note

`terminal.js` contains a local `parseActivityLogTerminal` function that reimplements `parseActivityLog` with different date formatting ("Mar 10" instead of "2026-03-10") and a 2-entry limit. This is the **only** known parsing duplication. It exists because the terminal needs compact human-readable dates, not ISO dates. If the terminal is ever extended, consider adding a `format` option to the shared `parseActivityLog` instead.

### Internal Structure

```
terminal.js
├── Config loader (loadConfig)
├── parseActivityLogTerminal()  — local variant with "Mar 10" dates
├── ANSI helpers (bold, dim, italic, cyan, yellow, green)
├── Layout helpers (boxLine, boxTop, boxBottom, boxDivider, boxSeparator, pad, truncate)
└── Main render loop
    ├── Header (SCRIBULAR HUB + stage)
    ├── Per-repo section (name, git status, task count, task list, activity)
    └── Footer (totals + date)
```

---

## Data Flow Summary

```
config.json
    │
    ▼
loadConfig(hubDir)
    │
    ├──► parseTaskFile(todo.md)      ──► { sections, openCount, doneCount }
    ├──► parseActivityLog(activity-log.md) ──► { stage, entries }
    ├──► getGitInfo(repoPath)        ──► { branch, dirtyCount }
    └──► parseSwarmDir(notes/swarm/) ──► [{ id, status, progress, results, ... }]
             │
             ├──► cli.js     → JSON stdout
             ├──► terminal.js → ANSI box art
             └──► server.js  → Express REST API → React SPA
```

All write operations (`writeTaskDone`, `writeTaskAdd`, etc.) go through `parsers.js` and are consumed by both `cli.js` (write commands) and `dashboard/server.js` (POST endpoints).
