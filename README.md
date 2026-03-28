<div align="center">

# Dispatch

<img src="docs/dispatch-loop.gif" alt="dispatch loop" width="200">

**Agents for your markdown files, not the other way around.**

</div>

---

You already have `todo.md`. You already have `activity-log.md`. Every coordination tool I tried wanted another copy- import them, sync them, store them somewhere else.

Dispatch reads your files as-is. Dispatch agents from a dashboard, watch them work in a terminal, validate the output. Your markdown stays the source of truth. The dashboard is a lens over it.

<img src="docs/app.png" alt="app overview" width="500">

> **Experimental.** YOLO mode on by default. Working prototype, not a finished product. Rough edges guaranteed.

## What it's not

**Not a chat interface.** Claude.ai and ChatGPT are for conversations. Dispatch is for work. The unit is a task with a defined outcome, not a message thread you scroll back through.

**Not an agent.** Dispatch doesn't write code or run commands itself. It coordinates the agents that do- Claude Code, Codex, OpenClaw. You still pick the agent and review the work.

**Not OpenClaw.** OpenClaw is an agent gateway- it runs models and manages their permissions. Dispatch is the coordination layer on top. They complement each other; Dispatch supports OpenClaw as an agent option.

**Not a task manager.** Linear, Jira, and GitHub Issues are databases with task-shaped views. They want to own your work history. Dispatch reads your existing `todo.md` and writes back to it. You can stop using Dispatch today and nothing is lost.

**Not Devin or Copilot Workspace.** Those are cloud platforms that manage agents in their infrastructure. Dispatch runs locally, coordinates agents in your terminal, and stores everything in files you control.

---

## Principles

- Doesn't touch your existing setup
- Markdown is the truth. No new file formats, no database, no sync
- One agent per task

## Security

The CLI (`cli.js`, `parsers.js`) has zero third-party dependencies- only Node.js built-ins (`fs`, `path`, `child_process`). No npm supply chain exposure for the coordination layer.

The dashboard has 15 production dependencies: React, Express, xterm.js (terminal emulator), node-pty (pseudo-terminal), and supporting utilities. Nothing phones home. No accounts, no telemetry, no API keys stored by Dispatch.

The server binds to `localhost` only. It is not safe to expose to a network.

`node-pty` compiles a native binary during install- it's the one step that requires build tools. If `yarn install` fails, install `python3` and Xcode Command Line Tools (macOS) or `build-essential` (Linux) first.

---

## What it does

- **Task dashboard** — open tasks and activity across all your repos in one place
- **Agent dispatch** — start Claude Code sessions from the dashboard, watch terminal output live
- **Auto-completion** — validate a job and it marks the task done in `todo.md`, logs it to `activity-log.md`
- **Job history** — every agent run logged to a markdown file in `notes/jobs/`
- **CLI** — JSON output for scripting and agent-to-agent queries

## Task lifecycle

**1. Write a task**

Add a task to `todo.md` in any connected repo:

```markdown
- [ ] Change the app logo to green
```

Or add it from the dashboard.

<img src="docs/tasks.png" alt="tasks" width="500">

**2. Dispatch from the dashboard**

Click Start on a task to open the pre-filled dispatch form. Review, edit, send.

<img src="docs/dispatch.png" alt="Dispatch form" width="500">

**3. Agent works**

A terminal opens in that repo with your prompt. The agent writes incremental progress to the job file as it goes. Watch live or come back later.

<img src="docs/terminal.png" alt="terminal" width="500">

**4. Review**

When the agent finishes, the job moves to the review queue. Open it to read the progress log and see what changed.

<img src="docs/jobs.png" alt="jobs" width="500">

**5. Validate**

Click Validate. Dispatch:
- Marks the task done in `todo.md`
- Logs an entry to `activity-log.md`

The job file in `notes/jobs/` stays as a permanent record.

<img src="docs/review.png" alt="review" width="500">

---

## What gets installed

Nothing globally.

**In the Dispatch directory:**

| What | Path |
|------|------|
| Dashboard (React + Express) | `dashboard/` |
| CLI + parsers | `cli.js`, `parsers.js` |
| Claude skills (`/dispatch`, `/add-repo`, `/done`) | `.claude/skills/` |

**In each repo you connect (via `/add-repo`):**

| What | Path |
|------|------|
| `hub-stop.js` hook | `.claude/hooks/` |
| `protect-env.js` hook | `.claude/hooks/` |
| Hook registration | `.claude/settings.json` (merged with any existing config) |
| `todo.md`, `bugs.md`, `activity-log.md` | repo root (only created if missing) |

`hub-stop.js` is a no-op unless Dispatch dispatched that Claude session. Normal Claude usage in your repos is unaffected.

---

## Setup

### 0. Install tmux

tmux keeps agent sessions alive across dashboard restarts. Without it, running Claude sessions die whenever the dashboard restarts.

```bash
# macOS
brew install tmux

# Ubuntu/Debian
sudo apt install tmux
```

Dispatch uses tmux automatically when available. It works without tmux- sessions just won't survive restarts.

### 1. Clone and install

```bash
git clone https://github.com/pi0neerpat/dispatch
cd dispatch/dashboard && yarn install && cd ..
```

### 2. Open in Claude Code

```bash
claude .
```

### 3. Connect your repos

In the Claude Code conversation:

```
/add-repo
```

Claude asks for the repo name, path, and optional scripts, then sets everything up. Repeat for each repo you want to track.

### 4. Start the dashboard

```bash
cd dashboard && yarn dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## How it works

1. Open tasks in your repos' `todo.md` files appear in the dashboard
2. Click a task to dispatch a Claude Code agent- it opens a terminal session in that repo
3. The agent writes progress to `notes/jobs/YYYY-MM-DD-slug.md` as it works
4. Validate the job and Dispatch marks it done in `todo.md`, logs it to `activity-log.md`

The dashboard reads your files. It doesn't own them.

---

## File formats

Dispatch reads and writes standard markdown. If you already have these files, they're picked up as-is.

### Tasks — `todo.md`

```markdown
## Open

- [ ] Add input validation to the API
- [ ] Write tests for auth module

## Done

- [x] Set up CI pipeline
```

### Bugs — `bugs.md`

```markdown
## Open

- [ ] Login fails on Safari

## Fixed

- [x] 500 error on empty form submit
```

### Activity — `activity-log.md`

Updated automatically when you validate a job. Also writable via `/done`.

```markdown
# My Repo — Activity Log

**Current stage:** MVP

## 2026-03-24

- **Added auth module** — JWT-based auth with refresh tokens
```

---

## CLI reference

```bash
node cli.js status              # Overview of all repos
node cli.js tasks               # All open tasks across repos
node cli.js tasks --repo=app    # Tasks for one repo
node cli.js swarm               # Active and recent agent jobs
node cli.js repos               # List configured repos
node cli.js config              # Dump full resolved config
```

All output is JSON- designed for scripting and agent consumption.

---

## Claude skills

Three skills are active when Claude Code is opened in the Dispatch directory:

| Skill | Invoke | What it does |
|-------|--------|--------------|
| `/dispatch` | `/dispatch` or "what should I work on?" | CLI view across all your markdown files- tasks, activity, what to work on next |
| `/add-repo` | `/add-repo` | Connect a new repo to Dispatch |
| `/done` | `/done` or "we're done" | Mark a task done and log activity manually |

`/done` is for work done outside the dashboard- manual sessions, ad-hoc fixes, anything not dispatched through the UI.

---

## What's next

- Better agent lifecycle management (tmux persistence is working; orphan cleanup is ongoing)
- Support for other agents: Codex, Cursor, etc.
