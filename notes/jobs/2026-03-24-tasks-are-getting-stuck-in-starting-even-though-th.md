# Job Task: tasks are getting stuck in "starting", even though they run successfully. Examine the job lifecycle and determine where the issue is. Review the code for quality, redundancy, and areas for improvement.
Started: 2026-03-24 15:29:48
Status: Killed
Repo: hub
Session: session-43c96e23-3a83-4225-a918-0c40880ce37f
SkipPermissions: true
Model: claude-opus-4-6
MaxTurns: 10
BaseBranch: github-integration

## Progress
- [2026-03-24 15:29:48] Task initiated from dashboard
- [2026-03-24 15:30:15] Traced job lifecycle: dispatch → createRun(STARTING) → createPtySession → startPendingLaunch → finalizeSession
- [2026-03-24 15:31:00] Found root cause: STARTING→RUNNING transition only happens in syncRunForTerminalAttach (WebSocket attach), not when the command is actually written to PTY in startPendingLaunch
- [2026-03-24 15:31:30] Found secondary bugs: createRun doesn't set startedAt for STARTING state; no startup cleanup for orphaned runs after server restart

## Findings

### Root Cause: STARTING→RUNNING transition depends on WebSocket client

The run state machine in `server.js` has a gap between PTY creation and the RUNNING state:

1. **Dispatch** (`POST /api/jobs/init`, line 575): Creates run with `state: STARTING`
2. **PTY created** (`createPtySession`, line 1322): Spawns shell, stores `pendingLaunch`
3. **WebSocket attaches** (`syncRunForTerminalAttach`, line 156): Transitions STARTING→RUNNING — **only if a client attaches**
4. **RESIZE message** (`startPendingLaunch`, line 1304): Actually writes Claude command to PTY — **does NO state transition**

If the frontend doesn't attach a WebSocket (e.g., user navigates away, tab is closed, or frontend polls slower than server dispatches), the run stays in STARTING forever even though Claude runs successfully.

### Bug 2: `createRun` doesn't set `startedAt` for STARTING state

`createRun` (line 109) only sets `startedAt` when state is `RUNNING`. But `transitionRun` (line 131) sets it for both `STARTING` and `RUNNING`. Since dispatch calls `createRun` directly with `STARTING`, `startedAt` is null on those runs.

### Bug 3: No orphan cleanup after server restart

When the server restarts, all PTY sessions are lost (in-memory only). But `job-runs.json` retains runs in `STARTING` or `RUNNING` state. There's no startup reconciliation to finalize these orphaned runs. Currently 6+ runs are stuck in `running` from days ago.

### Fixes Applied

1. **`startPendingLaunch`**: Transition run to RUNNING when command is written to PTY
2. **`createRun`**: Set `startedAt` for STARTING state too
3. **Server startup**: Finalize orphaned STARTING/RUNNING/STOPPING runs that have no live PTY session

## Results


## Killed
Killed at: 2026-03-24T17:33:23.256Z