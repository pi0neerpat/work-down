# Swarm Task: Kill agent control from dashboard
Started: 2026-03-11
Status: Completed
Validation: Validated

## Progress
- Completed Part 1: parsers.js -- added `writeSwarmKill` function, `agentId` parsing in `parseSwarmFile`, `killed` status in `normalizeStatus`, exported new function
- Completed Part 2: server.js -- added `POST /api/swarm/:id/kill` endpoint, imported `writeSwarmKill`
- Completed Part 3: SwarmPanel.jsx -- added `killed` statusConfig with Ban icon, Stop button with inline confirmation in AgentCard header, imported Ban and Square icons
- Part 4: No CSS changes needed (killed status reuses failed colors)
- Verified parsers.js loads correctly with all exports
- Verified CLI still works after changes
- End-to-end tested writeSwarmKill: status changes to killed, agentId parsed correctly, .kill marker file created

## Results
All 4 parts implemented successfully:

1. **parsers.js** (`/Volumes/My Shared Files/scribular/hub/parsers.js`):
   - `normalizeStatus` handles 'killed' -> 'killed'
   - `parseSwarmFile` parses `AgentId:` header, returns `agentId` in result object
   - `writeSwarmKill(filePath)` -- changes Status to Killed, appends ## Killed section with ISO timestamp, writes `.kill` marker file, returns `{ success, id, agentId }`
   - Exported in `module.exports`

2. **server.js** (`/Volumes/My Shared Files/scribular/hub/dashboard/server.js`):
   - Imported `writeSwarmKill` from parsers
   - Added `POST /api/swarm/:id/kill` endpoint that searches all repos for the swarm file and calls `writeSwarmKill`

3. **SwarmPanel.jsx** (`/Volumes/My Shared Files/scribular/hub/dashboard/src/components/SwarmPanel.jsx`):
   - Added `killed` to `statusConfig` with `Ban` icon and failed colors
   - Added Stop button (Square icon) in AgentCard header for in_progress agents
   - Inline confirmation: first click shows "Stop?", second click confirms, auto-cancels after 3s
   - Calls `onSwarmRefresh` after successful kill

4. **theme.css** -- No changes needed; killed reuses `--status-failed` colors with a different icon (Ban) and label (Killed).

## Validation
End-to-end test confirmed:
- `parseSwarmFile` correctly parses `AgentId:` header
- `writeSwarmKill` changes status to Killed, writes .kill marker
- `normalizeStatus('killed')` returns 'killed'
- CLI still works after all changes
- All existing exports intact
