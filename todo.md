# Hub — Task Tracker

## Open

- [x] Determine if there will be conflicts if two machines are running the dashboard, and managing the same todo files. Eg separate backends, but same markdown files.
- [x] Example task: configure repos in config.json
- [ ] Review the current code for quality and brevity.
- [x] Update the Hub Logo to Work.Down
- [x] old task
- [x] Make the app logo green
- [x] Please review the feedback in https://share.galexc.io/30d/feedback-for-patrick.md and add actionable item to the todo list.
- [ ] Flip `SkipPermissions` from default-on to explicit opt-in. the default in settings should be off
- [x] Use `git worktree add` per dispatched job to isolate branches and prevent git state collisions
- [x] Add unit tests for parsers.js (markdown parsing, fuzzy matching, stemming, word overlap scoring)
- [ ] Make `maxTurns` required with sensible defaults; add rough cost-per-job tracking via token counts
- [ ] Promote markdown job files as canonical state; derive `.hub-runtime/job-runs.json` as cache to reduce dual-state sync bugs
- [ ] Add auth to the Express dashboard server (required before any remote/Tailscale access)
- [x] Add structured `## Results Summary` section to job files (Changes, Decisions, Discoveries, Follow-up)
- [ ] Create `/remove-repo` skill to uninstall hooks and remove config entries (inverse of `/add-repo`)
- [ ] Reframe "no parallelism" from hard principle to current limitation; plan worktree-based parallel dispatch. see https://share.galexc.io/30d/feedback-for-patrick.md for reference
- [ ] Evaluate SQLite backing store for task/activity data if markdown parsing hits reliability issues at scale. see https://share.galexc.io/30d/feedback-for-patrick.md for reference
- [x] Currently the terminal tab must be opened by the user for a job to actually kick off. Is Claude Code doing this to enforce usage only in viewable terminals? Would using the -p flag fix this? Or is it something simple causing the issue?
- [x] In dispatch, add an additional dropdown for choosing the AI, before model. Add Codex, and Claude as options. Then update the terminal command accordingly. Also include this information in the job markdown file.
- [x] In the task list, clicking to edit a task sometimes scrolls me down the page. i cannot click to edit them. investigate.
- [x] Determine if we really do need getting-started injected in every prompt, or if there is a hook for only the first prompt?
- [ ] Write a product showcase video script for Work Down. I will handle video production using the /remotion skill when you are done. You should focus on the following items: open-source, local-first, lightweight.
- [ ] Use my existing script "notes/promo-video-script.md" to write a /plan to implement a remotion video using the /remotion skill. I will provide the .mp4 files, you can help by also including the list of videos I need to make with suggestions about content.

## Done

