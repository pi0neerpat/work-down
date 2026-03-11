# Swarm Task: once started, a todo item check box should become an indicator that the task is in progress, and not allow me to edit it, change its status or start a new session. I should instead be presented with a way to open the bee currently performing that task
Started: 2026-03-11 20:28:01
Status: Complete
Validation: Validated
Repo: hub
Session: session-1773260881106

## Progress
- [2026-03-11 20:28:01] Task initiated from dashboard
- [2026-03-11 20:28:30] Read App.jsx and TaskBoard.jsx — understood current architecture
- [2026-03-11 20:28:45] Plan: 1) Pass agentTerminals + onOpenBee to TaskBoard in App.jsx, 2) Add worker-matching logic and "Open Bee" button in TaskBoard.jsx, 3) Disable checkbox/edit/start/move for in-progress tasks
- [2026-03-11 20:29:00] Edited App.jsx — passed `activeWorkers` and `onOpenBee` props to TaskBoard
- [2026-03-11 20:29:15] Edited TaskBoard.jsx — added `Eye` import, `findActiveWorker` helper, in-progress task rendering with spinning loader, "View" button, and disabled interactions
- [2026-03-11 20:29:30] Verified build succeeds with `npx vite build` — no errors

## Results

### Changes Made

**`dashboard/src/App.jsx`** (1 edit):
- In the `contentMap` useMemo for repo/tasks view, added two new props to `<TaskBoard>`:
  - `activeWorkers={agentTerminals}` — passes the Map of active agent terminals
  - `onOpenBee` — callback that sets `selection` to the bee's session and switches to the terminal tab

**`dashboard/src/components/TaskBoard.jsx`** (4 edits):
1. Added `Eye` to lucide-react imports
2. Updated component signature to accept `activeWorkers` and `onOpenBee` props
3. Added `findActiveWorker(taskText, repoName)` helper that iterates the `activeWorkers` Map to find a matching session by task text + repo name
4. Rewrote open task rendering with conditional branches for in-progress tasks:
   - **Checkbox** replaced with a spinning `Loader` icon in `text-status-active` color
   - **Task text** rendered as plain `<span>` (no double-click edit handler)
   - **Start button** hidden
   - **Move button** hidden
   - **"View" button** shown always (not hover-gated) as a rounded pill with `Eye` icon, styled with `text-status-active bg-status-active-bg`
   - **Row background** gets a subtle `bg-status-active-bg/30` tint to visually distinguish active tasks
   - The `group` class is only applied to non-working tasks (so hover effects don't apply to in-progress rows)

## Validation
- Dashboard builds successfully with no errors
- All existing task functionality preserved for non-active tasks
- Active task detection uses exact string match on `taskText` + `repoName` from the `agentTerminals` Map
