# Swarm Task: Organize worker bees under each respective repo they serve, rather than in one place
Started: 2026-03-11 20:04:24
Status: Complete
Validation: Validated
Repo: hub
Session: session-1773259464743

## Progress
- [2026-03-11 20:04:24] Task initiated from dashboard
- [2026-03-11 20:05:00] Read Sidebar.jsx, App.jsx, SwarmDetail.jsx to understand current data flow
- [2026-03-11 20:05:30] Implemented groupAgentsByRepo() replacing flat groupAgents()
- [2026-03-11 20:06:00] Restructured sidebar JSX: workers now nested under each repo
- [2026-03-11 20:06:15] Removed unused Bug import (no longer needed without separate Worker Bees section)
- [2026-03-11 20:06:30] Verified brace/paren/bracket balance
- [2026-03-11 20:06:45] Verified production build succeeds (vite build, 0 errors)

## Results

### Changes Made
**File: `dashboard/src/components/Sidebar.jsx`**

1. **Replaced `groupAgents()`** with `groupAgentsByRepo()` -- groups agents by `agent.repo` first, then by status within each repo. Returns `{ repoName: { statusKey: agent[] } }` instead of flat `{ statusKey: agent[] }`.

2. **Removed the separate "Worker Bees" section** (lines 133-256 in old file). The divider and entire bottom section are gone.

3. **Added nested worker groups under each repo row.** After each repo button, if the repo has workers (`totalWorkers > 0`), a nested `<div>` renders status groups (REVIEW, RUNNING, DONE, FAILED) with agent rows indented under them.

4. **Per-repo DONE collapse state.** Changed `doneCollapsed` from a single boolean to an object `{ repoName: boolean }`. Default is collapsed (`true`). Each repo's DONE group can be toggled independently.

5. **Activity indicator on repo rows.** Added a pulsing dot next to the repo name when it has running (`in_progress`) or review (`needs_validation`) workers. Uses review color (amber) if there are review items, otherwise active color (green).

6. **Removed repo badge from agent rows.** Since workers are now nested under their repo, the small colored repo-name badge on each agent row is redundant and was removed.

7. **Slightly smaller nested elements.** Status group headers use `text-[8px]` (was `text-[9px]`) and status dots use `w-1 h-1` (was `w-1.5 h-1.5`) to visually distinguish nested content from repo-level content.

8. **Cleaned up unused import.** Removed `Bug` from lucide-react imports since the Worker Bees section header no longer exists.

### What Was Preserved
- All existing imports (repoIdentityColors, statusConfig, groupOrder, cn)
- Selection logic (repo click -> onSelect repo, agent click -> onSelect swarm)
- Agent sorting (newest first within each status group)
- Active worker merging (agentTerminals Map entries that aren't already in swarm.agents)
- All prop types and signatures (overview, swarm, selection, onSelect, etc.)
- Repo row styling (color dot, name, branch info, task count badge)
- Agent row styling (status icon, spinner animation, task name truncation)

## Validation
- Brace/paren/bracket balance: OK
- Production build (vite build): OK, 0 errors
- All 1783 modules transformed successfully
