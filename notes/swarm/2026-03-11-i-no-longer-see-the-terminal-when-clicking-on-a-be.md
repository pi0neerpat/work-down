# Swarm Task: I no longer see the terminal when clicking on a bee. I just see "No terminal for this worker."
Started: 2026-03-11 20:39:16
Status: Complete
Validation: Validated
Repo: hub
Session: session-1773261556730

## Progress
- [2026-03-11 20:39:16] Task initiated from dashboard
- [2026-03-11] Identified root cause: ID mismatch between sidebar selection and terminal sessions map
  - `agentTerminals` Map is keyed by `session-<timestamp>` (e.g. `session-1741700000000`)
  - Sidebar swarm agents from API have IDs like `2026-03-11-some-task` (swarm file slug)
  - When clicking a bee that has a swarm file, `onSelect({ type: 'swarm', id: agent.id })` passes the swarm file slug
  - `TerminalPanel` checks `sessions.has(activeSessionId)` which fails because the slug doesn't match `session-*` key
  - Result: "No terminal for this worker." placeholder shown
- [2026-03-11] Fixed by:
  1. Added `swarmFileToSession` reverse lookup (slug → session ID) in App.jsx
  2. Added `activeTerminalSessionId` that resolves selection.id through the reverse map
  3. TerminalPanel now receives the resolved session ID instead of raw selection.id
  4. Sidebar highlight also checks reverse map for cross-ID matching
  5. Build verified successfully

## Results
Root cause: When a swarm file appears in the API data, the sidebar shows the agent with its file slug as the ID. Clicking it sets `selection.id` to the slug, but `TerminalPanel` looks up sessions by `session-*` keys. The two ID spaces never matched.

Fix: A `swarmFileToSession` reverse lookup resolves swarm file slugs to their corresponding session IDs. This resolved ID is passed to `TerminalPanel` as `activeTerminalSessionId`. The Sidebar also uses this map to highlight the correct bee regardless of which ID form is in the selection.

Files changed:
- `dashboard/src/App.jsx` — added `swarmFileToSession` memo, `activeTerminalSessionId` resolution, passed to TerminalPanel and Sidebar
- `dashboard/src/components/Sidebar.jsx` — accepts `swarmFileToSession` prop, uses it for highlight matching
