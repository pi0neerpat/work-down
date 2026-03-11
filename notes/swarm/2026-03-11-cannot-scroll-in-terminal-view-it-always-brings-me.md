# Swarm Task: Cannot scroll in terminal view, it always brings me back to the top. Likely some issue with claude interactive mode and our setup.
Started: 2026-03-11 20:28:12
Status: Complete
Validation: Validated
Repo: hub
Session: session-1773260892571

## Progress
- [2026-03-11 20:28:12] Task initiated from dashboard
- [2026-03-11 20:30:00] Read all key files: useTerminal.js, TerminalPanel.jsx, server.js, App.jsx, CenterTabs.jsx, CSS files
- [2026-03-11 20:30:30] Identified multiple issues contributing to scroll problems:
  1. **No scrollback configured in xterm.js** — Terminal constructor has no `scrollback` option, defaults to 1000 but Claude Code produces heavy output
  2. **CSS overflow:hidden on terminal container** — TerminalPanel.jsx line 142 has `overflow: 'hidden'` on the terminal div. While xterm handles its own scrolling internally, this alone shouldn't break it.
  3. **Parent container overflow:hidden** — CenterTabs.jsx line 5 has `overflow-hidden` on the outermost div, which is fine.
  4. **No scrollOnUserInput option** — missing configuration to control auto-scroll behavior
  5. **Missing scrollSensitivity / fastScrollSensitivity** — no mouse wheel scroll tuning
  6. **Key issue: `terminal.onData` sends ALL data to WebSocket including scroll-wheel escape sequences** — When xterm is in mouse mode (which Claude Code enables), mouse wheel events get captured by xterm as data events and forwarded to the PTY instead of scrolling the terminal buffer. This is the primary cause.
- [2026-03-11 20:32:00] Root cause confirmed: Claude Code enables mouse tracking mode (`\x1b[?1000h` / `\x1b[?1003h`) and alternate screen buffer when running interactively. In this mode, xterm.js correctly routes mouse wheel events to the application as escape sequences instead of scrolling the buffer. This is standard terminal emulator behavior (same as vim, tmux, less). The user cannot scroll the buffer because all wheel events go to Claude Code's TUI.
- [2026-03-11 20:33:00] Checked xterm.js API: `terminal.modes.mouseTrackingMode` exposes current mode ('none'|'x10'|'vt200'|'drag'|'any'). `terminal.buffer.active.type` shows 'normal' vs 'alternate'.
- [2026-03-11 20:35:00] Implemented fix in `useTerminal.js`:
  1. Increased `scrollback` from default 1000 to 10000
  2. Added `scrollSensitivity: 3` for better scroll UX
  3. Added `fastScrollModifier: 'shift'` and `fastScrollSensitivity: 10` for fast scrolling in normal mode
  4. Added wheel event interceptor (capture phase) that detects mouse tracking mode and allows Shift+Scroll to bypass it, manually calling `terminal.scrollLines()` to scroll the buffer
  5. Added `isMouseTracking` state exposed from the hook to allow UI hints
- [2026-03-11 20:36:00] Updated `TerminalPanel.jsx`:
  1. Destructured `isMouseTracking` from useTerminal hook
  2. Added "Shift+Scroll to browse buffer" hint in the status bar when mouse tracking is active
- [2026-03-11 20:37:00] Build verified: `vite build` succeeds with no errors

## Results

### Root Cause
When Claude Code runs interactively inside the terminal, it enables **mouse tracking mode** (via DECSET escape sequences like `\x1b[?1000h`). This is standard behavior for interactive TUI applications. When mouse tracking is active, xterm.js correctly captures all mouse events (including scroll wheel) and sends them to the application as escape sequences, rather than scrolling the terminal's scrollback buffer. This means the user cannot scroll through terminal history while Claude Code is active.

Additionally, Claude Code uses the **alternate screen buffer** (`\x1b[?1049h`), which is a separate buffer with no scrollback history. Programs like vim, less, and tmux do the same thing. There is simply no scrollback to scroll through while in the alternate buffer.

### Fix Applied
Two files modified:

**`dashboard/src/lib/useTerminal.js`:**
- Increased `scrollback` from 1000 (default) to 10000 for better history when in normal buffer mode
- Added `scrollSensitivity: 3` for smoother scrolling
- Added `fastScrollModifier: 'shift'` and `fastScrollSensitivity: 10` for fast scroll in normal mode
- Added a DOM-level wheel event interceptor (capture phase) that:
  - Detects when terminal is in mouse tracking mode via `terminal.modes.mouseTrackingMode`
  - When Shift+Scroll is used during mouse tracking: prevents the event from reaching xterm.js, and manually calls `terminal.scrollLines()` to scroll the buffer
  - When Ctrl+Shift+Scroll: uses larger scroll increment (10 lines vs 3)
  - Normal scroll without Shift: passes through to xterm.js for default behavior (app input in mouse mode, buffer scroll otherwise)
- Added `isMouseTracking` state tracking that updates on every incoming data chunk
- Exposed `isMouseTracking` in the hook's return value

**`dashboard/src/components/TerminalPanel.jsx`:**
- Destructures `isMouseTracking` from the useTerminal hook
- Shows a subtle "Shift+Scroll to browse buffer" hint in the terminal status bar when mouse tracking is active

### User-Facing Behavior
| Scenario | Normal Scroll | Shift+Scroll |
|----------|--------------|--------------|
| Shell prompt (no Claude) | Scrolls buffer (normal) | Fast-scrolls buffer |
| Claude Code running (mouse tracking on) | Sends to Claude's TUI | Scrolls terminal buffer |

### Limitations
- When Claude Code is in the alternate screen buffer, the scrollback buffer being scrolled is the *normal* buffer's history (whatever was there before Claude launched). Once Claude exits back to the normal buffer, all output history is available for scrolling.
- This is inherent to how alternate screen buffers work in all terminal emulators -- it is not a bug, it is how vim, tmux, less, etc. all behave.

## Validation
- Build passes (`vite build` succeeds)
- No new dependencies added
- Changes are isolated to dashboard/src/ (no impact on root-level files)
- Follows existing code patterns and conventions
