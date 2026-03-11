# Swarm Task: agents shouldnt be organized into the done dropdown until they are validated. They should remain visible, with a "Needs validation" flag so I know they are ready for my input
Started: 2026-03-11 20:11:31
Status: Complete
Validation: Validated
Repo: hub

## Progress
- [2026-03-11 20:11:31] Task initiated from dashboard
- [2026-03-11] Analyzed Sidebar.jsx grouping logic — completed agents with validation='none' go straight to DONE (collapsed), hiding them
- [2026-03-11] Plan: Change groupAgentsByRepo() so completed+unvalidated agents stay in REVIEW group. Only validated agents go to DONE.
- [2026-03-11] Also need to auto-set validation='needs_validation' when agents complete — currently parsers.js sets it to 'none' by default
- [2026-03-11] Resumed session — confirmed parsers.js writeSwarmStatus already auto-sets validation to 'needs_validation' on completion
- [2026-03-11] Found 3 agents with completed+validation=none (kill-agent-control, organize-worker-bees, task-reassignment) — these were set before auto-validation logic existed
- [2026-03-11] Fixed Sidebar.jsx groupAgentsByRepo: completed agents with validation 'none' now route to 'needs_validation' (REVIEW) group instead of 'completed' (DONE)
- [2026-03-11] Updated agent row icon: completed+unvalidated agents show AlertCircle (review icon) instead of CheckCircle
- [2026-03-11] Verified full flow: complete→REVIEW, validate→DONE, reject→stays visible

## Results
Two changes in `dashboard/src/components/Sidebar.jsx`:

1. **`groupAgentsByRepo()`** (line 41-43): Added condition — completed agents with `validation === 'none'` or missing validation now route to the `needs_validation` (REVIEW) group instead of `completed` (DONE). Only validated agents go to DONE.

2. **Agent row rendering** (line 231-235): Completed+unvalidated agents display the `AlertCircle` review icon (amber) instead of the `CheckCircle` complete icon (green), making them visually distinct in the REVIEW section.

No backend changes needed — `parsers.js:writeSwarmStatus` already auto-sets `Validation: Needs validation` when agents complete. The 3 legacy agents with `validation: 'none'` are now handled by the UI-level fallback.
