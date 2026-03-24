# Job Task: Fix dispatch view settings being cleared on navigation

Started: 2026-03-23
Status: Killed
Validation: Validated

## Progress

- Identified race condition between restore and save useEffects in DispatchView
- Root cause: on remount after navigation, the save effect fired with default useState values, overwriting localStorage before the restore effect's state updates could trigger a corrective second save
- Fix: read localStorage synchronously via useRef before useState, so initial state values are already correct — eliminates the restore useEffect entirely

## Results

Changed `dashboard/src/components/DispatchView.jsx`:
- Replaced the restore `useEffect([], [])` with a synchronous `useRef`-based read of `dispatch-settings` from localStorage
- Used saved values as fallbacks in `useState()` initializers for repo, model, maxTurns, autoMerge
- The save `useEffect` now always writes correct values from the first render (no more default-overwrite race)

## Validation

- Navigate to dispatch, change settings (repo, model, turns, auto-merge)
- Navigate to another tab (jobs, tasks, etc.)
- Navigate back to dispatch — settings should persist
- Also verify page refresh still restores settings


## Killed
Killed at: 2026-03-23T20:16:52.349Z