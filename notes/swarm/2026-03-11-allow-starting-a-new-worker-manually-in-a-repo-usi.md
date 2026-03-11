# Swarm Task: Allow starting a new worker manually in a repo using a "Start worker" button
Started: 2026-03-11 20:28:39
Status: Complete
Validation: Rejected
Repo: hub

## Progress
- [2026-03-11 20:28:39] Task initiated from dashboard
- [2026-03-11 20:30:00] Analyzing Sidebar.jsx, App.jsx, TaskBoard.jsx, and server.js
- [2026-03-11 20:31:00] Implementation plan:
  1. Add "Start worker" button below each repo in Sidebar
  2. Pass onStartWorker callback from App → Sidebar
  3. Button starts a new terminal session in that repo, enters /swarm prompt
  4. User completes the message in the terminal

- [2026-03-11 20:35:00] Implementation complete. Build passes.

## Results

### Changes made:

**Sidebar.jsx:**
- Added `Plus` icon import from lucide-react
- Added `onStartWorker` prop to component signature
- Added "Start worker" button below each repo's worker bees list
- Button styled to match existing UI patterns (muted by default, highlights on hover)

**App.jsx:**
- Added `handleStartWorker(repoName)` function — creates a blank session with no task text
- Passed `onStartWorker={handleStartWorker}` prop to Sidebar

### Behavior:
- Clicking "Start worker" creates a new terminal session in the repo's directory
- Claude Code launches automatically (via existing `onConnected` in TerminalPanel)
- Since `taskText` is empty, no `/swarm` command is auto-sent — user types their own message
- View switches to the terminal tab showing the new session


## Validation Notes
- [2026-03-11] The start worker should be immediately below the repo card, above the other workers