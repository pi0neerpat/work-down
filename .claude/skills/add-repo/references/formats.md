# Work.Down File Formats

## config.json repo entry

All fields except `name` and `path` are optional (use `null` if unknown).

```json
{
  "name": "my-repo",
  "path": "../my-repo",
  "taskFile": "todo.md",
  "bugsFile": "bugs.md",
  "activityFile": "activity-log.md",
  "startScript": "npm run dev",
  "testScript": "npm run test",
  "cleanupScript": "rm -rf dist"
}
```

**Field notes:**
- `name` — short identifier used in CLI output and dashboard labels. Lowercase, no spaces.
- `path` — relative path from the hub root. Always `../repo-name` for sibling repos, `.` for the hub itself.
- `taskFile` — almost always `todo.md`. Only change if the repo uses a different name.
- `bugsFile` — optional. Set to `null` if the repo doesn't track bugs separately.
- `activityFile` — almost always `activity-log.md`.
- `startScript` — command to start the dev server. `null` if not applicable.
- `testScript` — command to run tests. `null` if not applicable.
- `cleanupScript` — command to clean build artifacts. `null` if not applicable.

The `hub` entry (path `.`) must always remain in the list and should not be modified.

---

## todo.md format

```markdown
# <Repo Name> — Task Tracker

## Open

- [ ] First task goes here

## Done

```

**Rules:**
- `## Open` section contains unchecked items `- [ ]`
- `## Done` section contains checked items `- [x]`
- The `## Bugs` section is optional — only add if the repo will track bugs in todo.md
- Do not add other sections on initial creation

---

## bugs.md format

```markdown
# <Repo Name> — Bugs

## Open

- [ ] First bug here

## Fixed

```

**Rules:**
- Same checkbox format as todo.md — parsers treat them identically
- `## Open` for unresolved bugs, `## Fixed` for resolved ones (not `## Done`)
- Keep separate from todo.md so bugs can be filtered independently in the dashboard

---

## activity-log.md format

```markdown
# <Repo Name> — Activity Log

**Current stage:** Getting started

## YYYY-MM-DD

- **Initial setup** — added to Work.Down hub

```

**Rules:**
- `**Current stage:**` line is required — parsers look for it
- Date headers use `## YYYY-MM-DD` format
- Entries are bullet points under the date header
- Bold text is the entry title, followed by ` — ` and a short description
