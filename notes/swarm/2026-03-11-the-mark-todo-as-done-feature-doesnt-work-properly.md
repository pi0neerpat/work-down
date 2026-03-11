# Swarm Task: Fix mark-todo-as-done by persisting original task text
Started: 2026-03-11 21:19:36
Status: Completed
Validation: Rejected
OriginalTask: the mark todo as done feature doesnt work properly, because the title of the item is updated during the swarm process. We need to persist the original todo text so that we can properly close the correct todo after validation
Repo: hub
Session: session-1773263976758

## Progress
- [2026-03-11 21:19:36] Task initiated from dashboard
- [2026-03-11 21:20:00] Read all three files: parsers.js (parseSwarmFile at lines 90-163), server.js (POST /api/swarm/init at lines 144-183), ResultsPanel.jsx (handleMarkDone at lines 153-174)
- [2026-03-11 21:20:30] Making changes: (1) Add OriginalTask parsing to parseSwarmFile, (2) Write OriginalTask in swarm init endpoint, (3) Use originalTask in ResultsPanel handleMarkDone

## Results


## Validation Notes
- [2026-03-11] no