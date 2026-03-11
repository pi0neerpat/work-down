# Plan: Log View as Default Worker Monitoring Surface

## Context

The xterm.js terminal embedded in the dashboard has an inherent scroll/jumping issue: Claude Code's TUI enables mouse tracking mode, which hijacks scroll events in the browser. This is a known limitation — no tool in the market (Conductor, Factory Factory) successfully embeds an interactive terminal as the primary monitoring view. They all use structured/scrollable views as default, with raw terminal as secondary.

**Solution:** Add a "Log" tab as the default view for workers that shows ANSI-stripped terminal output in a native scrollable `<div>`. The interactive Terminal tab stays mounted (hidden) to maintain the WebSocket/PTY connection, available via a "Go Interactive" button.

---

## Changes (4 files: 1 new, 3 modified)

### 1. `dashboard/server.js` — Server-side log processing + REST endpoint

**Add `stripAnsi()` utility** (after imports, ~line 18):
- Strip CSI sequences (`\x1b[...X`), OSC sequences (`\x1b]...\x07`), charset sequences (`\x1b(B`), and stray control characters

**Extend PTY session object** in `createPtySession()` (line 396-405):
- Add `logLines: []` — array of clean text lines
- Add `logLineBuffer: ''` — partial line accumulator between `\n` boundaries

**Process PTY output** in `shell.onData()` (line 407-416), after existing scrollback buffering:
- Strip ANSI from incoming data
- Append to `logLineBuffer`, split on `\n`
- Handle `\r` by keeping only content after last `\r` per line (handles TUI status bar redraws)
- Deduplicate consecutive empty lines
- Cap at 50K lines

**New REST endpoint: `GET /api/sessions/:id/log?since=N`**  (after line 463):
- Returns `{ lines: string[], total: number, alive: boolean }`
- `since` param enables incremental fetching (client sends last known total, gets only new lines)
- Returns 404 if session doesn't exist

**Delay session cleanup** in `shell.onExit()` (line 438):
- Change `ptySessions.delete(sessionId)` to `setTimeout(() => ptySessions.delete(sessionId), 5 * 60 * 1000)`
- Log data stays accessible for 5 minutes after PTY exits

### 2. `dashboard/src/components/LogPanel.jsx` — New component (create)

Scrollable log view with:
- **Polls** `/api/sessions/:id/log?since=N` every 2.5s with incremental fetching
- **Sticky auto-scroll**: scrolls to bottom as new lines arrive, stops when user scrolls up (within 40px threshold)
- **Status bar**: line count, "Go Interactive" button (switches to Terminal tab), running/ended indicator
- **Monospace rendering**: `whitespace-pre-wrap`, `break-all` for long lines
- **Fallback**: when no PTY session exists, fetches swarm progress entries from `/api/swarm/:id`
- **States**: loading, empty, session ended, error

### 3. `dashboard/src/App.jsx` — Wire up LogPanel, update tabs

- Import `LogPanel` and `ScrollText` icon
- Change `SWARM_TABS` to: `[Log, Terminal, Review]` (Log first = default)
- Add `log` entry to `contentMap` with `ptySessionId`, `swarmFileId`, `onGoInteractive` props
- Change `handleStartTask` and `handleStartWorker` to default to `'log'` tab instead of `'terminal'`

### 4. `dashboard/src/components/CenterTabs.jsx` — Persistent mounting for Log tab

- Extend the `tab.id === 'terminal'` special case to also include `'log'`
- Both tabs use CSS `display: none/block` toggle (never unmount)
- Preserves log scroll position and accumulated lines when switching tabs

---

## What Won't Change

- `TerminalPanel.jsx` — no modifications, stays exactly as-is
- `useTerminal.js` — no modifications, WebSocket connection unchanged
- `parsers.js` — no modifications
- The existing Terminal tab works identically, just moved to 2nd position

---

## Verification

1. Start dashboard: `cd dashboard && yarn dev`
2. Select a worker bee → should default to "Log" tab (not Terminal)
3. Log should show clean, scrollable text output from the PTY
4. Scroll up → auto-scroll stops. Scroll back to bottom → auto-scroll resumes
5. Click "Go Interactive" → switches to Terminal tab with full xterm.js
6. Switch back to Log → scroll position preserved, lines still accumulated
7. Kill a worker → Log shows "Session ended" indicator, stays viewable for ~5 min
8. Click a historical swarm agent (no PTY) → shows progress entries as fallback
