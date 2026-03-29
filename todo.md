# Hub — Task Tracker

## Planning 

- [ ] Solve markdown clobbering problem with serial operations in the server. Are there any other changes outside of the server process that could cause problems? — *Feedback: regex-based parsing has no transactions; concurrent writes corrupt files. At scale (50+ tasks, 5+ repos) consider SQLite as backing store with markdown as render format.*
- [x] Add OpenClaw agent — *Feedback: reviewer flagged that Claude Code runs in a bare PTY with no filesystem isolation. Adding more agent backends increases attack surface; pair new agent integrations with sandboxing (see agent sandboxing todo).*
- [ ] Create /plan to add ollama agent option (similar to how we planned OpenClaw)
- [ ] Frame video as “let’s build together” — *Feedback: reviewer validated several patterns worth highlighting: markdown as source of truth (“particularly clean engineering”), the human validation gate (“subtle but critical safety gate”), JSON CLI as agent API surface, and the hub-stop.js zero-footprint integration. These are strong demo beats.*
- [x] repo name under each job should be colored chips, to match how tasks are shown
- [ ] feat- Pop-out terminal session (allow choosing default terminal in settings). This allows you to "detach" a TUI terminal session from Dispatch and work on it outside of the dashboard in a real terminal
- [x] Feat- make separate page for dispatch button loading screen on startup (and for video)
- [x] Test cron jobs — *Feedback: test coverage was flagged as a critical gap. The parsers.js unit tests are now done, but scheduled/cron job execution paths remain untested. Verify schedule triggers, error handling on failed jobs, and cleanup of stale cron state.*
- [x] hydrate addition context for the existing todos, based on the feedback here: https://share.galexc.io/30d/feedback-for-patrick.md
- [ ] Implement OpenClaw agent feature in ./plans/openclaw-agent.md
- [ ] Quality of life improvements: brainstorm ideas for how to switch between tabs/jobs/task more easily. use behavioral product design skill.
- [ ] Job view is not actively updated. check polling logic and lets make this consistent across the app. Not having a consistently up-to-date dashboard is leading to bad UX /plan
- [x] follow up for a job needs to have all the same options as the dispatch (minus changing repo)
- [x] Follow up dispatch on a job needs to include all the inputs as on the dispatch page (except repo). Basically an inline dispatch view
- [ ] Implement skills selection when dispatching a task

## Features

- [x] Review the current code for quality and brevity — *Feedback: reviewer assessed code quality as "Clean, well-structured." Focus review effort on parsers.js edge cases (fuzzy matching, stemming) and dual-state sync patterns rather than broad refactoring.*
- [x] Make `maxTurns` required with sensible defaults; add rough cost-per-job tracking via token counts — *Feedback: the `monthlyBudget` field is purely informational today. Making maxTurns required prevents runaway jobs. Rough cost-per-job via token counts from Claude's output helps users understand spending.*
- [x] Promote markdown job files as canonical state; derive `.hub-runtime/job-runs.json` as cache to reduce dual-state sync bugs — *Feedback: job state currently lives in markdown (notes/jobs/*.md), run state in job-runs.json, schedules in schedules.json, and config in config.json. A job's Status: line can disagree with run state, creating reconciliation complexity. Markdown should be canonical; JSON should be derived cache.*
- [ ] Add auth to the Express dashboard server (required before any remote/Tailscale access) — *Feedback: port 3001 has no authentication. Anyone who can reach it can read tasks, dispatch jobs, validate/reject work, and access live terminal WebSocket sessions. Fine for strict localhost; mandatory before any remote access (e.g. over Tailscale).*
- [x] Write a product showcase video script for Work Down. I will handle video production using the /remotion skill when you are done. You should focus on the following items: open-source, local-first, lightweight.
- [x] Create `/remove-repo` skill to uninstall hooks and remove config entries (inverse of `/add-repo`) — *Feedback: `/add-repo` copies hooks into other repos' `.claude/` directories and modifies their `settings.json`. If someone stops using Dispatch, those hooks remain orphaned (`hub-stop.js` is a no-op without env vars, but still unexpected). A `/remove-repo` skill should clean up hooks and remove the config entry.*
- [ ] Reframe "no parallelism" from hard principle to current limitation; plan worktree-based parallel dispatch — *Feedback: the backend already supports parallelism (`ptySessions` is a Map, dashboard has multi-job views). Reviewer routinely dispatches 5-10 jobs in parallel. The real constraints are dashboard UX (watching 5 terminals at once) and git isolation. With worktrees now implemented, the backend is ready for parallelism.*
- [ ] Evaluate SQLite backing store for task/activity data if markdown parsing hits reliability issues at scale — *Feedback: regex-based parsing has no indexes (every read scans full file), no transactions (concurrent writes corrupt files), no schema enforcement (malformed lines silently disappear), and positional task numbering is unstable across edits. At ~50+ tasks across 5+ repos, SQLite would be a natural stepping stone — use it as backing store with markdown as render format.*

## Done

- [x] Currently the terminal tab must be opened by the user for a job to actually kick off. Is Claude Code doing this to enforce usage only in viewable terminals? Would using the -p flag fix this? Or is it something simple causing the issue?
- [x] Add structured `## Results Summary` section to job files (Changes, Decisions, Discoveries, Follow-up)
- [x] In dispatch, add an additional dropdown for choosing the AI, before model. Add Codex, and Claude as options. Then update the terminal command accordingly. Also include this information in the job markdown file.
- [x] Determine if we really do need getting-started injected in every prompt, or if there is a hook for only the first prompt?
- [x] In the task list, clicking to edit a task sometimes scrolls me down the page. i cannot click to edit them. investigate.
- [x] Use my existing script "notes/promo-video-script.md" to write a /plan to implement a remotion video using the /remotion skill. I will provide the .mp4 files, you can help by also including the list of videos I need to make with suggestions about content.
- [x] toggle buttons are broken
- [x] Add work tree flag to dispatch
- [x] Determine why work tree jobs show weird changes
- [x] Clean up existing work trees
- [x] Determine if there will be conflicts if two machines are running the dashboard, and managing the same todo files. Eg separate backends, but same markdown files.
- [x] Example task: configure repos in config.json
- [x] Update the Hub Logo to Work.Down
- [x] old task
- [x] Make the app logo green
- [x] Please review the feedback in https://share.galexc.io/30d/feedback-for-patrick.md and add actionable item to the todo list.
- [x] Flip `SkipPermissions` from default-on to explicit opt-in. the default in settings should be off
- [x] Use `git worktree add` per dispatched job to isolate branches and prevent git state collisions
- [x] Add unit tests for parsers.js (markdown parsing, fuzzy matching, stemming, word overlap scoring)