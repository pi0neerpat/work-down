bug# Swarm Task: Add session usage meter to header
Started: 2026-03-11
Status: Complete
Validation: Rejected
Skills: frontend-design

## Progress
- [2026-03-11 20:57] Task initiated. Read all three target files: TerminalPanel.jsx, App.jsx, HeaderBar.jsx, plus theme.css.
- [2026-03-11 20:57] Analysis of existing code:
  - TerminalPanel.jsx: regex `\$[\d.]+[^%]{0,20}(\d{1,3})%` captures percentage from Claude Code status bar
  - App.jsx: `contextUsage` state stores just a number (pct), `handleContextUsage(sessionId, pct)` callback
  - HeaderBar.jsx: Has progress bar (20px wide) with color-coding, shows "Session" label and pct text
  - Need to: (1) enhance regex to capture reset time, (2) expand state to include reset info, (3) enhance HeaderBar UI
- [2026-03-11 20:58] Starting implementation...
- [2026-03-11 20:59] Modified TerminalPanel.jsx: Enhanced regex to also capture reset time from Claude Code status bar. Added patterns for "Resets in 2h 3m", "Resets in 2 hr 3 min", hours-only "Resets in 2h". Passes resetMinutes as 3rd arg to onContextUsage.
- [2026-03-11 20:59] Modified App.jsx: Added `contextResetInfo` state alongside `contextUsage`. `handleContextUsage` now accepts (sessionId, pct, resetMinutes) and stores absolute `resetsAt` timestamp. Both states reset on session switch. Pass `contextResetInfo` to HeaderBar.
- [2026-03-11 21:00] Modified HeaderBar.jsx: Added `ResetCountdown` component with live countdown (updates every 30s). Enhanced session meter: subtle background when data present, improved color scale (green < 50%, yellow 50-80%, red > 80%), min-width on percentage, "--" placeholder, reset countdown inline. Matches existing badge aesthetic.
- [2026-03-11 21:00] Verified all three files compile correctly and changes are consistent.

## Results
All three files modified successfully:

1. **TerminalPanel.jsx** - Enhanced terminal output parsing to extract reset time from Claude Code's status bar alongside the existing percentage capture. Falls through gracefully when reset time is not present in the output.

2. **App.jsx** - Added `contextResetInfo` state to store the absolute reset timestamp (computed from relative minutes). Both `contextUsage` and `contextResetInfo` reset on session switch.

3. **HeaderBar.jsx** - Added `ResetCountdown` component with a live timer that shows "resets Xh Ym" text. Enhanced the session usage meter with:
   - Subtle background highlight when data is present
   - Improved color scale: green (< 50%), yellow/review (50-80%), red/failed (> 80%)
   - Fixed-width percentage display to prevent layout jitter
   - Inline reset countdown when available
   - Consistent with existing header badge styling (text-[10px], font-mono, muted colors)


## Validation Notes
- [2026-03-11] We need something more robust than this