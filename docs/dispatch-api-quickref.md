# Dispatch Hub API — minimal reference (for orchestrators)

Use this when integrating **another service or agent** (e.g. Darby) with the Dispatch dashboard server. For full detail, see [`agent-api.md`](./agent-api.md).

**Default base URL:** `http://127.0.0.1:3747` — replace host/port if the hub binds elsewhere (`PORT`, `DISPATCH_BIND`).

---

## Auth (when enabled)

If the hub sets **`DISPATCH_API_KEY`**, send the same secret on **every** HTTP call to `/api/*`:

| Header | Value |
|--------|--------|
| `X-API-Key` | `<key>` |
| *or* `Authorization` | `Bearer <key>` |

`Content-Type: application/json` is required for POST/PUT bodies.

Unauthorized requests return **`401`** with `{ "error": "..." }`.

---

## 1. Discover repos, agents, and models

```http
GET /api/catalog
```

Returns JSON including:

- **`repos`** — `name`, relative `path`, `taskFile`, `activityFile`, optional `bugsFile` (use **`name`** as `repo` when dispatching).
- **`agents`** — supported kinds: `claude`, `codex`, `cursor`.
- **`models`** — per-agent model lists (`value` / `label`).
- **`modelSources`** — how each list was resolved (`api`, `fallback`, `codex-cache`, …).
- **`hubRoot`** — hub root path hint.

---

## 2. Start a job

```http
POST /api/jobs/init
```

**Body (minimum):**

```json
{
  "repo": "<name from catalog>",
  "taskText": "<prompt for the coding agent>"
}
```

**Common optional fields:** `originalTask`, `agent` (`claude` default), `model`, `maxTurns`, `skipPermissions`, `useWorktree`, `baseBranch`, `autoMerge`, `planSlug`, `skills` (string array), `sessionId`, `extraFlags`.

**Response (typical):**

```json
{
  "fileName": "2026-04-02-slug.md",
  "relativePath": "notes/jobs/2026-04-02-slug.md",
  "absolutePath": "/…",
  "repo": "my-app",
  "sessionId": "session-<uuid>",
  "serverStarted": true,
  "branch": "job/2026-04-02-slug",
  "worktreePath": "/…"
}
```

Save **`sessionId`** and the job **`id`** (the slug, e.g. `2026-04-02-slug`, from `fileName` without `.md` or from `GET /api/jobs`).

Legacy alias: `POST /api/swarm/init` (same body).

---

## 3. Follow progress (polling)

There is **no** server-sent job stream for external clients. **Poll** on an interval (e.g. 1–3s).

**While the session exists in memory:**

```http
GET /api/sessions/<sessionId>/events?limit=120&cursor=<opaque>
```

Response: `{ "sessionId", "items": [...], "nextCursor" }` — pass **`nextCursor`** on the next request until null.

Optional rollup:

```http
GET /api/sessions/<sessionId>/summary
```

**If the hub restarts** or the session is gone, session endpoints may return **`404`**. Fall back to:

```http
GET /api/jobs/<jobId>
```

Parse status / validation from the job payload until the job reaches a terminal state (e.g. completed + needs review, failed, killed).

---

## 4. Job actions (after the agent stops)

| Action | Request |
|--------|---------|
| Approve | `POST /api/jobs/<id>/validate` — body `{ "notes": "optional" }` |
| Reject | `POST /api/jobs/<id>/reject` — body `{ "notes": "required" }` |
| Stop | `POST /api/jobs/<id>/kill` |
| Merge branch | `POST /api/jobs/<id>/merge` — body `{ "targetBranch": "main" }` optional |
| Delete job file | `DELETE /api/jobs/<id>` |

`/api/swarm/...` paths mirror `/api/jobs/...` for compatibility.

---

## 5. Errors

```json
{ "error": "Human-readable message" }
```

Typical: **`400`** invalid input, **`401`** auth, **`404`** missing resource, **`409`** bad state transition, **`500`** server error.

---

## 6. Optional: stop hook (Claude Code)

If the repo uses Dispatch’s Claude hook, completion may call:

```http
POST /api/hooks/stop-ready
```

Body: `{ "sessionId", "jobId", "reason" }` — usually not called by external orchestrators; listed for completeness.

---

## 7. WebSocket (terminal attach only)

`GET /ws/terminal?repo=...&session=...&jobFile=...` — interactive PTY for the dashboard, **not** required for HTTP-only orchestration. If `DISPATCH_API_KEY` is set, pass the key via **`X-API-Key`** on the upgrade or **`?apiKey=`** (browser limitation).
