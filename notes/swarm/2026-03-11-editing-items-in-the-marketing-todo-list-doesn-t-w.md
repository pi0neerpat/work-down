# Swarm Task: Fix todo parsing/editing for numbered tasks and multi-section files
Started: 2026-03-11 21:14:54
Status: Completed
Validation: Rejected
Repo: hub
Session: session-1773263694140

## Progress
- [2026-03-11 21:14:54] Task initiated from dashboard
- [2026-03-11 21:15:30] Read parsers.js — confirmed Bug 1: parseTaskFile regex on line 23 only matches `^- \[([ x])\]\s+(.+)` (dash-bullet format)
- [2026-03-11 21:15:30] Confirmed Bug 2: write functions (writeTaskDone, writeTaskEdit, writeTaskMove, writeTaskDoneByText) all use `^(\d+\.\s+|[-*]\s+)\[ \]\s+(.+)` which matches both numbered and bullet formats
- [2026-03-11 21:15:30] Applying fix: updating parseTaskFile regex to match both formats

## Results


## Validation Notes
- [2026-03-11] dnc