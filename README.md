# Work.Down

> **Experimental / testing grounds.** This is a working prototype, not a finished product. Expect rough edges.

A coordination hub for Claude Code workflows across multiple repos. Track tasks, dispatch AI agents, and monitor job progress — all backed by plain markdown files. No database, no external services.

## What it does

- **Task dashboard** — see open tasks and activity across all your repos in one place
- **Agent dispatch** — start Claude Code sessions from the dashboard, track progress live
- **Job history** — every agent run is logged to a markdown file in `notes/jobs/`
- **CLI** — JSON output for scripting and agent-to-agent queries

## What gets installed where

This is the full list. Nothing is installed globally or outside the directories you explicitly connect.

| What | Where | Why |
|------|-------|-----|
| Dashboard (React + Express) | `hub/dashboard/` | The web UI and API server |
| CLI + parsers | `hub/` | `node cli.js` commands — zero dependencies |
| Claude skills | `hub/.claude/skills/` | `/hub`, `/jobs`, `/add-repo` — only active in this directory |
| Claude hooks | `hub/.claude/hooks/` | `protect-env.js` — only active in this directory |
| `hub-stop.js` hook | `<each connected repo>/.claude/hooks/` | Signals the dashboard when a dispatched job finishes |
| `settings.json` entry | `<each connected repo>/.claude/settings.json` | Registers the hook — merged with any existing config |

The `hub-stop.js` hook is a no-op unless the hub dashboard is running and dispatched that session. It won't interfere with normal Claude usage in your repos.

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/your-org/workdown hub
cd hub/dashboard && yarn install && cd ..
```

> **Node.js version note:** `node-pty` requires Node 18 or 20. On Node 24+ the `postinstall` script rebuilds it from source automatically — this takes a minute on first install.

### 2. Open in Claude Code

```bash
cd hub
claude .
```

### 3. Add your repos

In the Claude Code conversation, run:

```
/add-repo
```

Claude will ask for the repo name, path, and optional scripts, then:
- Add it to `config.json`
- Create `todo.md`, `bugs.md`, and `activity-log.md` in that repo if they don't exist
- Install the `hub-stop.js` hook in that repo's `.claude/` directory

Repeat for each repo you want to track.

### 4. Start the dashboard

```bash
cd dashboard && yarn dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## File formats

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

All output is JSON — designed for scripting and agent consumption.

---

## Claude skills

Three skills are included and active when Claude Code is opened in this directory:

| Skill | Invoke | What it does |
|-------|--------|--------------|
| `/hub` | `/hub` or ask "what should I work on?" | Cross-repo task view and work recommendations |
| `/jobs` | `/jobs` followed by a task list | Launch multiple Claude sub-agents in parallel |
| `/add-repo` | `/add-repo` | Add a new repo to the hub (see Setup above) |

---

## Requirements

- Node.js 18+ (20 recommended)
- [Claude Code](https://claude.ai/code)
- Yarn: `corepack enable && corepack prepare yarn@stable --activate`

---

## Status

Experimental. Works in practice, but:

- No automated tests
- The word "swarm" appears in older parts of the codebase — being migrated to "jobs"
- Some UI rough edges in the dashboard

Contributions welcome.

## License

MIT
