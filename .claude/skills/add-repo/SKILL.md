---
name: add-repo
description: Add a new repository to the Work.Down hub. Updates config.json, scaffolds todo.md, bugs.md, and activity-log.md in the target repo, and installs the hub-stop hook so the dashboard can track job completion. Use when someone says "add a repo", "track a new repo", "connect a repo", or invokes /add-repo.
argument-hint: [repo-name or path]
allowed-tools: Read, Write, Edit, Bash(ls *), Bash(test *), Bash(mkdir *), Bash(cp *), Bash(node *)
---

# /add-repo — Add a Repository to the Hub

Add a new repo to `config.json`, scaffold its tracking files, and install the hub completion hook so the dashboard can track dispatched jobs.

**Reference:** [references/formats.md](references/formats.md) — config.json schema, and exact formats for todo.md, bugs.md, and activity-log.md. Read this before writing any files.

---

## Step 1: Read current config

```bash
node cli.js config
```

Note the existing repos (for duplicate detection) and the hub's resolved path (you'll need it to locate the hook file to copy).

---

## Step 2: Gather repo info

If `$ARGUMENTS` was provided, infer the repo name or path from it. Otherwise ask:

> **To add a repo I need a few details:**
>
> 1. **Repo name** — short identifier for the dashboard (e.g. `backend`, `mobile`, `docs`)
> 2. **Path** — relative path from the hub root (e.g. `../my-backend`)
> 3. **Start script** — command to run the dev server (e.g. `npm run dev`), or skip
> 4. **Test script** — command to run tests, or skip
> 5. **Cleanup script** — command to remove build artifacts, or skip

Ask all at once. Wait for answers before proceeding.

---

## Step 3: Validate

**Check 1 — Path exists:**
```bash
test -d <resolved-path> && echo "exists" || echo "not found"
```

If the directory doesn't exist, stop:
> "The directory `<path>` doesn't exist. Create the repo first, then run `/add-repo` again."

**Check 2 — Not already registered:**
Compare against the repos from Step 1. If name or path matches an existing entry, stop:
> "`<name>` is already registered in config.json. Nothing to do."

---

## Step 4: Preview and confirm

Show exactly what will happen before touching anything:

```
## About to add `<name>`:

config.json        — add entry (path: <path>)

Files to create in <path>/ (skipped if already exist):
  todo.md          — task tracker
  bugs.md          — bug tracker
  activity-log.md  — activity log

Hook to install in <path>/.claude/:
  hooks/hub-stop.js   — signals the dashboard when a job finishes
  settings.json       — registers the hook (merged with existing if present)

Nothing is installed globally. All changes are scoped to <path>/.

Proceed? (yes / adjust details)
```

Wait for confirmation.

---

## Step 5: Update config.json

Read `config.json`, add the new repo entry to the `repos` array — insert it before the `hub` entry (which must stay last). Use the schema from [references/formats.md](references/formats.md). Set any unspecified scripts to `null`.

---

## Step 6: Scaffold missing tracking files

Check each file and only create if it doesn't already exist:

```bash
test -f <resolved-path>/todo.md          && echo "exists" || echo "missing"
test -f <resolved-path>/bugs.md          && echo "exists" || echo "missing"
test -f <resolved-path>/activity-log.md  && echo "exists" || echo "missing"
```

Create any that are missing using the exact formats from [references/formats.md](references/formats.md). Use today's date in the activity log entry.

---

## Step 7: Install the hub-stop hook

This hook signals the dashboard when a Claude job finishes. It's a no-op when the hub isn't running — safe to install without affecting normal Claude usage in that repo.

**7a. Create the hooks directory and copy the hook file:**
```bash
mkdir -p <resolved-path>/.claude/hooks
cp "$CLAUDE_PROJECT_DIR/.claude/hooks/hub-stop.js" <resolved-path>/.claude/hooks/hub-stop.js
```

**7b. Install the hook in that repo's settings.json:**

Check if `<resolved-path>/.claude/settings.json` exists:
```bash
test -f <resolved-path>/.claude/settings.json && echo "exists" || echo "missing"
```

- **If missing:** create it with this content:
```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/hub-stop.js\""
          }
        ]
      }
    ]
  }
}
```

- **If it exists:** read it, check whether a Stop hook pointing to `hub-stop.js` is already present. If not, merge in the Stop hook entry above — preserve all existing hooks.

---

## Step 8: Confirm

```bash
node cli.js repos
```

Report what was done:

```
Done. `<name>` is now connected to the hub.

  config.json          ✓ updated
  <path>/todo.md       ✓ created  (or: already existed, left unchanged)
  <path>/bugs.md       ✓ created  (or: already existed, left unchanged)
  <path>/activity-log.md  ✓ created  (or: already existed, left unchanged)
  <path>/.claude/hooks/hub-stop.js  ✓ installed
  <path>/.claude/settings.json      ✓ updated

Nothing was installed globally.

Run `node cli.js status` to see it in the overview.
```

---

## Rules

- **Always read formats.md before writing files** — exact format matters; parsers silently fail on malformed files.
- **Never overwrite existing tracking files** — only create todo.md, bugs.md, activity-log.md if missing.
- **Never modify or remove the `hub` entry** — it must always remain in config.json pointing to `.`.
- **Always confirm before writing** — show the Step 4 preview and wait. Don't apply changes speculatively.
- **Null beats omitting** — always include `startScript`, `testScript`, `cleanupScript` in the config entry even as `null`. Omitting them causes CLI errors.
- **Hub entry goes last** — insert new entries before the `hub` entry.
- **Merge, don't overwrite settings.json** — if the target repo already has a `.claude/settings.json`, merge the Stop hook in rather than replacing it.
- **Self-improvement**: If the user corrects a format detail or says "never do X again", update the Rules section and/or `references/formats.md` immediately. If a new validation case comes up, add it as a rule.
