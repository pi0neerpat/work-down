# Dispatch Server API — Agent Reference

Base URL: `http://127.0.0.1:3747` (or your hub host when `DISPATCH_BIND` exposes the LAN).

All request and response bodies are JSON. All write endpoints require `Content-Type: application/json`.

---

## Authentication and server options

When **`DISPATCH_API_KEY`** is set on the hub process, every **`/api/*`** request must include that key:

- Header `Authorization: Bearer <key>`, or
- Header `X-API-Key: <key>`

The **`/ws/terminal`** WebSocket accepts the same key via header (`X-API-Key` / `Authorization`, e.g. Vite dev proxy) or query parameter **`apiKey=<key>`** (e.g. browser connecting straight to the hub).

| Env | Purpose |
|-----|---------|
| `DISPATCH_API_KEY` | If set, required for all HTTP `/api/*` and for `/ws/terminal` as above. |
| `DISPATCH_BIND` | Listen address (default `127.0.0.1`). Use `0.0.0.0` only with a firewall + API key on untrusted networks. |
| `PORT` | HTTP port (default `3747`). |

For **`yarn dev`**, put `DISPATCH_API_KEY` in `dashboard/.env.local` so the Vite proxy forwards it. For a **production build** served by the hub with auth enabled, set **`VITE_DISPATCH_API_KEY`** at build time to the same value (see `dashboard/env.example`).

---

## Read Endpoints

### Hub overview
```
GET /api/overview
```
Returns all repos with task counts, recent activity, git status, and checkpoints.

```json
{
  "hubRoot": ".",
  "stage": "...",
  "repos": [
    {
      "name": "my-app",
      "git": { "branch": "main", "dirtyCount": 2, "branches": ["main"] },
      "tasks": { "openCount": 5, "doneCount": 12, "sections": [...], "allTasks": [...] },
      "bugs":  { "openCount": 1, "doneCount": 3, "sections": [...], "allTasks": [...] },
      "activity": { "stage": "...", "entries": [...] },
      "lastActivity": { "date": "2026-03-30", "bullet": "..." },
      "checkpoints": [...]
    }
  ],
  "totals": { "openTasks": 6, "doneTasks": 15 },
  "monthlyBudget": null
}
```

### Config
```
GET /api/config
```
Returns `config.json` (repo list, paths, hubRoot, etc.).

### Jobs
```
GET /api/jobs
```
Returns all jobs across all repos.

```json
{
  "jobs": [
    {
      "id": "2026-03-30-fix-login-bug",
      "repo": "my-app",
      "taskName": "Fix login bug",
      "agent": "claude",
      "started": "2026-03-30 14:00:00",
      "status": "in_progress",
      "validation": "none",
      "runState": "running",
      "session": "session-<uuid>",
      "branch": "job/2026-03-30-fix-login-bug",
      "worktreePath": "/path/to/worktree",
      "planSlug": null,
      "planTitle": null
    }
  ],
  "summary": { "active": 1, "completed": 3, "failed": 0, "needsValidation": 1 }
}
```

**Job status values:** `in_progress` | `completed` | `failed` | `killed`
**Validation values:** `none` | `needs_validation` | `validated` | `rejected`
**runState values:** `queued` | `starting` | `running` | `stopping` | `awaiting_validation` | `validated` | `rejected` | `failed` | `killed`

### Single job
```
GET /api/jobs/:id
```
Returns full job detail parsed from the job markdown file.

### Job diff
```
GET /api/jobs/:id/diff?base=main
```
Returns git diff stats for the job's branch vs base.

```json
{
  "files": [{ "status": "M", "path": "src/foo.js" }],
  "insertions": 10,
  "deletions": 2,
  "commits": 1,
  "merged": false
}
```
Returns `{ "merged": true }` if the worktree was already merged or the job has no branch.

### Activity log
```
GET /api/activity?limit=20
```
Returns recent activity entries across all repos, newest first.

```json
{
  "entries": [
    { "date": "2026-03-30", "bullet": "Fixed login bug", "repo": "my-app" }
  ]
}
```

### Plans
```
GET /api/plans
```
Returns all plans across all repos (no content body).

```
GET /api/plans/:repoName/:slug
```
Returns a single plan with full markdown content.

### Skills
```
GET /api/skills
```
Returns available skills.

```json
{
  "local": [{ "id": "local:done", "name": "done", "source": "local" }],
  "global": [{ "id": "global:dispatch", "name": "dispatch", "source": "global" }]
}
```

### Catalog (repos + agents + models)
```
GET /api/catalog
```
Single response for orchestrators: connected **repos** (name, relative `path`, task/activity/bugs files), supported **agent** kinds with labels, per-agent **models** (same logic as `/api/agents/models`), and **`modelSources`** (`api`, `fallback`, `codex-cache`, etc.).

```json
{
  "hubRoot": ".",
  "repos": [
    { "name": "my-app", "path": "../my-app", "taskFile": "todo.md", "activityFile": "activity-log.md", "bugsFile": "bugs.md" }
  ],
  "agents": [
    { "id": "claude", "label": "Claude" },
    { "id": "codex", "label": "Codex" },
    { "id": "cursor", "label": "Cursor" }
  ],
  "models": {
    "claude": [{ "value": "claude-opus-4-6", "label": "..." }],
    "codex": [],
    "cursor": []
  },
  "modelSources": { "claude": "api", "codex": "codex-cache", "cursor": "fallback" }
}
```

### Models
```
GET /api/agents/models?agent=claude
GET /api/agents/models?agent=codex
GET /api/agents/models?agent=cursor
```
Returns available model list. Falls back to hardcoded defaults if API is unavailable.

### Checkpoints
```
GET /api/repos/:name/checkpoints
```

### Schedules
```
GET /api/schedules
```

---

## Dispatch a Job

```
POST /api/jobs/init
```

**Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `repo` | string | yes | Repo name (from config) |
| `taskText` | string | yes | The prompt sent to the agent |
| `originalTask` | string | no | Human-readable task label (shown in UI) |
| `agent` | string | no | `"claude"` (default), `"codex"`, or `"cursor"` |
| `model` | string | no | Model ID e.g. `"claude-opus-4-6"` |
| `maxTurns` | number | no | Max agent turns |
| `skipPermissions` | boolean | no | Pass the provider-specific permission-bypass flag |
| `plainOutput` | boolean | no | Run with `-p --output-format text` (captures stdout) |
| `useWorktree` | boolean | no | Create an isolated git worktree for this job |
| `baseBranch` | string | no | Base branch for worktree (default: `main`) |
| `autoMerge` | boolean | no | Auto-merge worktree after completion |
| `planSlug` | string | no | Link this job to a plan by slug |
| `skills` | string[] | no | Skill IDs to include (from `/api/skills`) |
| `sessionId` | string | no | Reuse an existing session ID |
| `extraFlags` | string | no | Extra CLI flags (allowlisted: `--verbose`, `--no-color`) |

**Response:**
```json
{
  "fileName": "2026-03-30-fix-login-bug.md",
  "relativePath": "notes/jobs/2026-03-30-fix-login-bug.md",
  "absolutePath": "/abs/path/notes/jobs/2026-03-30-fix-login-bug.md",
  "repo": "my-app",
  "sessionId": "session-<uuid>",
  "serverStarted": true,
  "branch": "job/2026-03-30-fix-login-bug",
  "worktreePath": "/path/to/worktree"
}
```

---

## Job Lifecycle

### Validate (approve completed work)
```
POST /api/jobs/:id/validate
Body: { "notes": "optional notes" }
```
Marks job validated, closes terminal session, marks originating task done, logs activity.

### Reject (send back for rework)
```
POST /api/jobs/:id/reject
Body: { "notes": "reason for rejection" }   ← required
```
Cleans up worktree. Job can be resumed after rejection.

### Kill (terminate a running job)
```
POST /api/jobs/:id/kill
```
Kills the terminal process, cleans up worktree.

### Resume (restart after stop)
```
POST /api/jobs/:id/resume
```
Requires a `ResumeId` in the job file (written by Claude's session stop hook).

### Merge worktree
```
POST /api/jobs/:id/merge
Body: { "targetBranch": "main" }   ← optional, defaults to job's baseBranch
```
Merges the job's branch into target, removes worktree.

### Delete job
```
DELETE /api/jobs/:id
```
Removes job file, cleans up worktree and run records.

---

## Tasks

```
POST /api/tasks/add
Body: { "repo": "my-app", "text": "Task description", "section": "Optional section" }

POST /api/tasks/done
Body: { "repo": "my-app", "taskNum": 3 }

POST /api/tasks/done-by-text
Body: { "repo": "my-app", "text": "partial task text to match" }

POST /api/tasks/reopen-by-text
Body: { "repo": "my-app", "text": "partial task text to match" }

POST /api/tasks/edit
Body: { "repo": "my-app", "taskNum": 3, "newText": "Updated text" }

POST /api/tasks/move
Body: { "fromRepo": "my-app", "toRepo": "other-repo", "taskNum": 3, "section": "Optional" }
```

---

## Bugs

Same as tasks, using `/api/bugs/*`. Requires `bugsFile` configured for the repo.

```
POST /api/bugs/add          { repo, text, section }
POST /api/bugs/done         { repo, taskNum }
POST /api/bugs/done-by-text { repo, text }
POST /api/bugs/reopen-by-text { repo, text }
POST /api/bugs/edit         { repo, taskNum, newText }
```

---

## Plans

```
PUT /api/plans/:repoName/:slug
Body: { "content": "# Plan title\n..." }

POST /api/plans/:repoName/:slug/status
Body: { "status": "ready" }   ← omit or null to clear
```

---

## Checkpoints

```
POST /api/repos/:name/checkpoint
```
Creates a checkpoint branch (`checkpoint/YYYYMMDD-HHMMSS`) in the repo.

```
POST /api/repos/:name/checkpoint/:id/revert
```
Resets repo to a checkpoint. **Destructive.**

```
DELETE /api/repos/:name/checkpoint/:id
```
Deletes a checkpoint branch.

---

## Hooks (used by agents, not humans)

```
POST /api/hooks/stop-ready
Body: { "sessionId": "session-<uuid>", "jobId": "2026-03-30-slug", "reason": "stop_hook" }
```
Called by `.claude/hooks/hub-stop.js` when a Claude session ends. Marks the job as `awaiting_validation`.

---

## Schedules

```
POST /api/schedules
Body: { "name": "Daily sync", "repo": "my-app", "cron": "0 9 * * *", "prompt": "...", "model": "claude-opus-4-6" }

PUT /api/schedules/:id
Body: { "name": "...", "cron": "...", "prompt": "...", "model": "..." }

DELETE /api/schedules/:id

POST /api/schedules/:id/toggle
```

---

## Error format

All errors return a JSON body:
```json
{ "error": "Human-readable message" }
```

Common status codes: `400` bad request, `404` not found, `409` conflict (e.g. invalid state transition), `500` server error.

---

## Environment variables set for dispatched agents

When the server launches a Claude session, it injects:

| Variable | Value |
|----------|-------|
| `HUB_API_BASE` | `http://127.0.0.1:3747` |
| `HUB_SESSION_ID` | The session ID |
| `HUB_JOB_ID` | The job ID |
| `HUB_REPO` | The repo name |

Agents can use these to call back to the hub (e.g. to mark progress or signal completion).
