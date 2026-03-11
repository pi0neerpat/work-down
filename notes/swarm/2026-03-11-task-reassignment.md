# Swarm Task: Task reassignment between repos
Started: 2026-03-11
Status: Complete
Validation: Validated

## Progress
- Read existing parsers.js, server.js, and TaskBoard.jsx to understand patterns
- Added writeTaskMove() function to parsers.js following writeTaskDone pattern
- Added writeTaskMove to module.exports in parsers.js
- Added writeTaskMove import in server.js
- Added POST /api/tasks/move endpoint in server.js with validation
- Added ArrowRightLeft icon import, repoIdentityColors map, movingTask state, handleMoveTask function, and move UI to TaskBoard.jsx
- Verified writeTaskMove export: typeof === "function"
- Verified frontend build: vite build succeeded (1769 modules, no errors)

## Results
All three parts implemented successfully:

1. **parsers.js**: writeTaskMove(sourceFile, taskNum, destFile, section) - finds Nth open task, removes from source, adds to dest via writeTaskAdd
2. **server.js**: POST /api/tasks/move with fromRepo/toRepo/taskNum/section body params, full validation
3. **TaskBoard.jsx**: Move icon (ArrowRightLeft, 12px) appears on hover with group-hover:opacity-100, click opens inline dropdown of other repos as colored pill buttons, e.stopPropagation prevents triggering mark-done, on success calls onOverviewRefresh

## Validation
- `node -e "const p = require('./parsers'); console.log(typeof p.writeTaskMove)"` => "function"
- `npx vite build` => success, 1769 modules transformed, built in 1.51s
