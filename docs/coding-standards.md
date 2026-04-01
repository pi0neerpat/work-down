# Scribular Hub — Coding Standards

Authoritative style guide for the Scribular coordination hub and its dashboard.
Last updated: 2026-03-21.

---

## 1. General Principles

**Simplicity over abstraction.** Every file in the hub core is self-contained and
readable top-to-bottom. If a 20-line function solves the problem, do not introduce
a class hierarchy or a framework.

**Minimal dependencies.** The hub core (`parsers.js`, `cli.js`, `terminal.js`) has
zero npm dependencies — only Node.js built-ins (`fs`, `path`, `child_process`).
The dashboard has a small, curated dependency set. Before adding any new package,
ask whether the same result can be achieved with what is already available.

**Fail gracefully.** Parsers never throw on missing or malformed files. They
return empty defaults (`[]`, `''`, `0`) so consumers can always render something.
Use bare `try/catch` with empty catch blocks for file operations:

```js
try {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  // parse...
} catch { /* file missing */ }
return { sections: [], openCount: 0, doneCount: 0 };
```

**Agent-first design.** The CLI produces structured JSON to stdout for machine
consumption. Errors go to stderr as JSON. The terminal dashboard produces
ANSI-formatted output for humans. The web dashboard consumes the same parser
functions via an Express API. All three surfaces share a single parsing layer.

---

## 2. JavaScript Standards

### Module system

| Context | Module format | Example |
|---|---|---|
| Hub core (Node.js) | CommonJS | `const fs = require('fs')` / `module.exports = { ... }` |
| Dashboard server | ESM with CommonJS bridge | `import express from 'express'` + `createRequire` for parsers |
| Dashboard client (React) | ESM | `import { useState } from 'react'` |

The hub core uses CommonJS because it has zero dependencies and runs directly via
`node`. The dashboard uses ESM (`"type": "module"` in its `package.json`) but
bridges to the CommonJS parsers using `createRequire`:

```js
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { parseTaskFile, parseActivityLog } = require('../parsers')
```

### Variable declarations

- `const` by default.
- `let` only when the variable will be rebound (e.g., loop counters, accumulators).
- Never `var`.

```js
const sections = [];
let currentSection = null;
let openCount = 0, doneCount = 0;
```

### Destructuring

Use destructuring for imports and extracting fields:

```js
const { execSync } = require('child_process');
const { parseTaskFile, parseActivityLog, getGitInfo, loadConfig } = require('./parsers');
```

### String interpolation

Use template literals, not string concatenation:

```js
console.log(`Hub dashboard API running at http://localhost:${PORT}`);
```

### Semicolons

Hub core files use semicolons. Dashboard files (ESM) omit them. Follow the
convention of the file you are editing.

| Context | Semicolons |
|---|---|
| `parsers.js`, `cli.js`, `terminal.js` | Yes |
| `dashboard/server.js`, React components, hooks | No |

### JSX

JSX is used only in `dashboard/src/` files (`.jsx` extension). Hub core files
are plain `.js`.

### TypeScript

This project does not use TypeScript. All files are plain JavaScript.

### Error handling

For file/git operations, wrap in `try/catch` and return safe defaults on failure.
The catch block may be empty with a comment:

```js
try {
  const branch = execSync(`git -C "${repoPath}" branch --show-current`, { encoding: 'utf8' }).trim();
  return { branch, dirtyCount };
} catch {
  return { branch: '?', dirtyCount: 0 };
}
```

For API endpoints, let Express handle errors or return JSON error responses:

```js
res.status(404).json({ error: `Swarm agent "${req.params.id}" not found` });
```

### Functions

Use named function declarations for top-level functions in the hub core:

```js
function parseTaskFile(filePath) { ... }
function getGitInfo(repoPath) { ... }
```

Use arrow functions for callbacks and in React components where appropriate:

```js
config.repos.map(repo => ({ ...repo, resolvedPath: path.resolve(hubDir, repo.path) }))
```

---

## 3. File Organization

### Hub core structure

```
hub/
  config.json          # Repo registry — single source of truth for paths
  parsers.js           # Shared parsing functions (consumed by everything)
  cli.js               # Agent-facing CLI (JSON to stdout)
  terminal.js          # Human-facing ANSI dashboard
  dashboard/           # Web dashboard (Express + React SPA)
    server.js          # Express API server
    src/               # React application
      App.jsx          # Root component
      components/      # UI components (PascalCase.jsx)
      lib/             # Utilities and hooks
      styles/          # CSS (Tailwind + theme)
    vite.config.js     # Build configuration
    package.json       # Dashboard-only dependencies
  .hub-runtime/        # Runtime state: job-runs.json, staged prompts, event logs
  plans/               # Markdown planning documents
  notes/
    jobs/              # Primary job progress files (YYYY-MM-DD-slug.md)
  docs/                # Documentation
  dot-claude/          # Project-specific Claude Code skills and hooks
```

### Key architectural rules

1. **`parsers.js` is the single source of truth** for all data parsing. The CLI,
   terminal, and dashboard server all import from it. Never duplicate parsing
   logic.

2. **CLI, terminal, and dashboard are consumers** of parsers. They format and
   present data but do not define how data is read or structured.

3. **The hub core has no `package.json`** and no `node_modules/`. It runs on
   Node.js built-ins only. The `dashboard/` subdirectory is the only part with
   npm dependencies.

4. **Configuration lives in `config.json`** at the repo root. It defines the
   list of coordinated repos, each with a `name`, `path` (relative to hub root),
   `taskFile`, and `activityFile`.

---

## 4. Dashboard Standards (React)

### Components

- **Functional components only.** No class components.
- **Named `export default`** for the primary component in each file.
- **Internal helper components** (e.g., `AgentCard` inside `SwarmPanel.jsx`) are
  defined as plain functions in the same file — not exported.

```jsx
function AgentCard({ agent, index }) {
  const [expanded, setExpanded] = useState(false)
  // ...
}

export default function SwarmPanel({ swarm }) {
  // ...
}
```

### Data fetching

Use the `usePolling` custom hook for all API data:

```jsx
const overview = usePolling('/api/overview', 10000)  // 10s interval
const swarm = usePolling('/api/swarm', 5000)          // 5s interval
```

The hook returns `{ data, loading, error, lastRefresh, refresh }` and handles
AbortController cleanup automatically.

### Styling

- **Tailwind CSS v4** via the `@tailwindcss/vite` plugin.
- **CSS custom properties** for all colors, defined in `src/styles/theme.css`
  under `:root`. The `@theme inline` block maps them to Tailwind's color system.
- **`cn()` utility** (from `src/lib/utils.js`) for conditional class merging.
  It wraps `clsx` + `tailwind-merge`:

```jsx
import { cn } from '../lib/utils'

<div className={cn(
  'w-8 h-8 rounded-lg flex items-center justify-center',
  st.bg,
  isActive && 'ring-2 ring-primary'
)} />
```

### Icons

Use `lucide-react` for all icons. Import individual icons, not the barrel export:

```jsx
import { Activity, CheckCircle, XCircle, Loader } from 'lucide-react'
```

### Animations

Custom animations are defined in `theme.css` as `@keyframes` with corresponding
utility classes:

| Class | Animation | Duration |
|---|---|---|
| `animate-fade-up` | Fade in + translate up 8px | 0.4s |
| `animate-slide-in` | Fade in + translate left 6px | 0.3s |
| `animate-pulse-soft` | Gentle opacity pulse | 2s infinite |
| `animate-glow-pulse` | Box-shadow pulse | 2.5s infinite |

Use `animationDelay` via inline styles for staggered entry:

```jsx
<div className="animate-fade-up" style={{ animationDelay: `${index * 60}ms` }}>
```

---

## 5. API Design

### CLI output contract

All CLI output is JSON to stdout. Errors are JSON to stderr.

```js
// Success — stdout
process.stdout.write(JSON.stringify(obj, null, 2) + '\n');

// Error — stderr, then exit
process.stderr.write(JSON.stringify({ error: msg }) + '\n');
process.exit(1);
```

CLI commands: `status`, `tasks`, `swarm`, `repos`, `activity`, `config`.

### Express API endpoints

The dashboard API mirrors the CLI commands:

| Endpoint | CLI equivalent | Description |
|---|---|---|
| `GET /api/overview` | `cli.js status` | Full overview (stage, repos, tasks, git) |
| `GET /api/jobs` (legacy `/api/swarm`) | `cli.js swarm` | All job agents with summary counts |
| `GET /api/jobs/:id` (legacy `/api/swarm/:id`) | `cli.js swarm <id>` | Single job detail |
| `GET /api/config` | `cli.js config` | Raw hub config |

### Polling intervals

| Endpoint | Interval | Rationale |
|---|---|---|
| `/api/overview` | 10 seconds | Task and git data change slowly |
| `/api/swarm` | 5 seconds | Legacy alias still used by the client for job status polling |

### Server configuration

- Port: `3747` (`process.env.PORT || 3747` in `server.js`).
- CORS enabled for development (Vite dev server proxies `/api` to the Express
  server).
- Static file serving from `dist/` in production with SPA fallback.

---

## 6. Data Contracts

### Config format (`config.json`)

```json
{
  "repos": [
    {
      "name": "marketing",
      "path": "../marketing-dept-scribular",
      "taskFile": "todo.md",
      "activityFile": "activity-log.md"
    }
  ],
  "hubRoot": "/Volumes/My Shared Files/scribular/hub"
}
```

Fields:
- `name` — Short identifier (used in CLI output and dashboard labels).
- `path` — Relative to the hub root directory.
- `taskFile` — Markdown file with `## Section` headers and `- [ ]`/`- [x]` checkboxes.
- `activityFile` — Markdown file with `## YYYY-MM-DD` date headers and bullet entries.

The `loadConfig` function resolves relative paths to absolute via `path.resolve`.

### Task file format

```markdown
## Section Name

- [ ] Open task description
- [x] Completed task description -- **DONE**
- [ ] Another open task (optional note)

## Another Section

- [ ] More tasks here
```

Parser behavior:
- Extracts `## ` headers as section names (strips trailing parenthetical notes).
- Extracts `- [ ]` and `- [x]` lines as tasks.
- Strips bold markers, "DONE" annotations, and parenthetical suffixes from task text.
- Returns `{ sections, openCount, doneCount }`. Only sections with open tasks
  are included in the `sections` array.

### Activity log format

```markdown
**Current stage:** Stage 3 — Feature Development

## 2026-03-11

- **Did the thing** (details)
- Another entry

## 2026-03-10

- Earlier work
```

Parser behavior:
- Extracts `**Current stage:**` value as `stage`.
- Extracts `## YYYY-MM-DD` as date headers.
- Captures the first bullet under each date as the entry summary.
- Returns `{ stage, entries: [{ date, bullet }] }`.

### Job file format (`notes/jobs/YYYY-MM-DD-slug.md`)

```markdown
# Job Task: Task Name Here
Started: 2026-03-11
Status: In progress
Session: session-abc123
SkipPermissions: true

## Progress
- [2026-03-11] Step one description
- [2026-03-11] Step two description

## Results
Summary of what was accomplished.

## Validation
Notes on validation status.
```

Header fields (parsed from line-level patterns, not YAML frontmatter):
- `# Job Task: <name>` — Preferred task title header.
- `# Swarm Task: <name>` — Legacy header still accepted by parsers.
- `Started: <date>` — Local-time timestamp, no timezone suffix (e.g. `2026-03-31 16:39:56`). **See Timestamp Rules below.**
- `Status: <value>` — Normalized to: `in_progress`, `completed`, `failed`, or the raw lowercase value.
- `Validation: <value>` — Optional. Values like `needs_validation`, `validated`, `rejected`.
- `Session: <id>` — PTY session ID used by the dashboard to reconnect/resume.
- `SkipPermissions: <bool>` — Whether Claude was launched with `--dangerously-skip-permissions`.
- `ResumeId: <id>` and `ResumeCommand: <cmd>` — Persisted when Claude emits a resumable session id.

Section content:
- `## Progress` — Bullet list of timestamped progress entries.
- `## Results` — Free-form text summarizing outcomes.
- `## Validation` — Free-form text with validation notes.

The file ID is derived from the filename (minus `.md` extension):
e.g., `2026-03-11-create-claude-md.md` becomes ID `2026-03-11-create-claude-md`.

The dashboard still reads legacy `notes/swarm/` directories and parser aliases, but new work should be written to `notes/jobs/`.

### Timestamp Rules

All timestamps written by this codebase (job files, activity logs) are **local machine time with no timezone suffix**.

**Do not append `Z` or any UTC offset when parsing them.** JavaScript's `new Date()` interprets a string without a timezone suffix as local time, which is correct. Appending `Z` forces UTC interpretation and produces wrong relative times for users in non-UTC timezones.

```js
// ✅ Correct — parsed as local time
const d = new Date(started.replace(' ', 'T'))

// ❌ Wrong — forces UTC, will be hours off
const d = new Date(started.replace(' ', 'T') + 'Z')
```

This applies everywhere timestamps are compared to `Date.now()`:
- `parsers.js` `parseJobFile` → `durationMinutes`
- `dashboard/src/lib/utils.js` `timeAgo`
- Any new code that computes elapsed time from a stored timestamp

---

## 7. Git Conventions

### Commit messages

Use imperative mood. Explain the "why," not just the "what."

```
Add swarm polling to dashboard overview

The dashboard was only showing static data. Swarm agents update frequently
so a 5-second polling interval gives operators timely feedback.
```

Bad: "Updated SwarmPanel.jsx" (describes the file, not the intent).

### Branch naming

- `feature/<slug>` — New functionality.
- `fix/<slug>` — Bug fixes.

### What not to commit

- **`.claude/`** — Project-specific skills and hooks. Listed in `.gitignore` as
  the `.claude/` directory is workspace-specific.
- **`node_modules/`** — Standard npm exclusion.
- **`.env` files** — Environment-specific secrets.
- **`.DS_Store`** — macOS finder metadata.

### Git status in parsers

The hub tracks git status for all coordinated repos via `git -C` commands
(branch, dirty file count). This data is surfaced in CLI, terminal, and
dashboard.

---

## 8. Naming Conventions

### Files

| Type | Convention | Examples |
|---|---|---|
| Hub core modules | camelCase `.js` | `parsers.js`, `cli.js`, `terminal.js` |
| React components | PascalCase `.jsx` | `SwarmPanel.jsx`, `HeaderBar.jsx`, `TaskBoard.jsx` |
| Hooks and utilities | camelCase `.js` | `usePolling.js`, `utils.js` |
| Markdown docs | kebab-case `.md` | `web-dashboard-plan.md`, `coding-standards.md` |
| Job progress files | `YYYY-MM-DD-slug.md` | `2026-03-11-create-claude-md.md` |
| Config | camelCase `.json` | `config.json` |
| CSS | kebab-case `.css` | `theme.css`, `tailwind.css` |

### Code identifiers

| Type | Convention | Examples |
|---|---|---|
| Functions | camelCase | `parseTaskFile`, `getGitInfo`, `loadConfig` |
| React components | PascalCase | `SwarmPanel`, `AgentCard`, `HeaderBar` |
| Local variables | camelCase | `openCount`, `currentSection`, `dirtyCount` |
| Constants (config-like) | UPPER_SNAKE_CASE | `HUB_DIR`, `PORT`, `COLS` |
| CSS custom properties | `--kebab-case` | `--background`, `--status-active`, `--card-border` |
| Config keys (JSON) | camelCase | `taskFile`, `activityFile`, `resolvedPath`, `hubRoot` |
| API endpoint paths | kebab-case | `/api/overview`, `/api/jobs/:id` |
| CLI commands | lowercase single word | `status`, `tasks`, `swarm`, `repos` |

---

## 9. CSS and Theming

### Architecture

The dashboard uses Tailwind CSS v4 with a two-file setup:

1. **`src/styles/tailwind.css`** — Imports Tailwind and configures source scanning:
   ```css
   @import 'tailwindcss' source(none);
   @source '../**/*.{js,jsx}';
   ```

2. **`src/styles/theme.css`** — Defines all design tokens as CSS custom properties
   on `:root`, then maps them into Tailwind's theme via `@theme inline`.

### Color system

Colors are organized into semantic groups:

- **Base:** `--background`, `--foreground`, `--foreground-secondary`
- **Card:** `--card`, `--card-foreground`, `--card-hover`, `--card-border`
- **Accents:** `--primary`, `--secondary`, `--muted`, `--accent`
- **Status:** `--status-active`, `--status-complete`, `--status-failed`, `--status-review`

Each status color has companion `-bg`, `-border`, and sometimes `-glow` variants
using rgba transparency for layered effects.

### Fonts

- Body: `'DM Sans', system-ui, -apple-system, sans-serif`
- Mono: `'JetBrains Mono', ui-monospace, 'SF Mono', monospace`

Applied via CSS custom properties `--font-body` and `--font-mono`.

---

## 10. UI State Persistence

### Rule: Persist view filter and tab state to localStorage

Any view that has a filter, active tab, or repo selector **must** persist that
selection to `localStorage` and restore it on mount. Users navigate between
tabs frequently; losing their filter state on every return is friction.

**Pattern:**

```js
const FILTER_KEY = 'myView:repoFilter'   // namespaced key

// Read once synchronously at init (pass function to useState)
const [repoFilter, setRepoFilter] = useState(
  () => { try { return localStorage.getItem(FILTER_KEY) || null } catch { return null } }
)

// Wrapper that persists every change
function setRepoFilterPersisted(val) {
  try {
    if (val) localStorage.setItem(FILTER_KEY, val)
    else localStorage.removeItem(FILTER_KEY)
  } catch {}
  setRepoFilter(val)
}
```

**Key naming convention:** `<viewName>:<stateKey>` — e.g.,
`allTasksView:filters`, `plansView:repoFilter`, `dispatchView:settings`.

This applies to:
- Repo filter pills
- Active tab / section selections
- Expanded/collapsed toggles that affect primary content visibility
- Any multi-value filter (status, timeframe, type)

Does **not** apply to ephemeral UI like hover states, open dropdowns, or
loading indicators.

---

## 11. Testing and Validation

There is currently no automated test suite. Validation is manual:

- **CLI:** Run `node cli.js status` and verify JSON output.
- **Terminal:** Run `node terminal.js` and visually inspect the ANSI rendering.
- **Dashboard:** Run `yarn dev` in `dashboard/` and check the browser at
  `http://localhost:5173`.
- **Job tasks:** Check the `Status:`, `SkipPermissions:`, and optional
  `ResumeId:` / `ResumeCommand:` headers plus the `## Validation` section in
  job progress files.

When adding new parser functions, verify they return safe defaults when given
missing files, empty files, and malformed content.
