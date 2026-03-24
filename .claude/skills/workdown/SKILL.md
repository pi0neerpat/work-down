---
name: workdown
description: Cross-repo task view and work prioritization. Shows open tasks, recent activity, and active jobs across all connected repos. Recommends what to work on next. Use when the user asks "what should I work on?", wants a status overview, or invokes /workdown.
---

# /workdown — Cross-Repo Status and Priorities

Provides a unified view of tasks, activity, and active jobs across all configured repos. Helps you decide what to work on next.

## When to Use

- User asks "what should I work on?"
- User wants a status overview across repos
- User invokes `/workdown`

## Instructions

### Step 1: Get data

```bash
node cli.js status
node cli.js tasks
```

If there are active jobs, also run:

```bash
node cli.js swarm
```

### Step 2: Present unified view

```
### <repo-name> (<branch>)
**Open tasks:** <count>
- [ ] task one
- [ ] task two

**Recent activity:** <date> — <summary>

---
(repeat for each repo)
```

If there are active jobs:

```
### Active Jobs
- <job-name>: <status> — <last progress note>
```

### Step 3: Recommend next actions

Based on the data, suggest what to work on next:

- Prioritize explicitly high-priority tasks
- Flag repos that haven't been touched recently
- Note dependencies between repos if apparent

Present as a short bulleted list under "**Suggested next:**".

## Notes

- If a repo path doesn't exist or files are missing, skip it with a note
- Keep output scannable — headers and bullets, not paragraphs
