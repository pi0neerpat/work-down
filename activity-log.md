# Hub — Activity Log

**Current stage:** Getting started

## 2026-03-30

- **Run button for worktree jobs** — implemented `POST /api/jobs/:id/run-dev` endpoint, `shell` agent branch in `startPendingLaunch`, Run button in `ResultsPanel`, and run-dev session state in `JobDetailView`; `worktreeSetup` config field runs setup commands before `startScript`; run-dev session killed on validate/reject/kill; `{repoPath}` placeholder interpolated with escaped path
- **Worktree dev server symlink fix** — resolved Turbopack rejecting out-of-root symlinks via sed patch to `web/next.config.ts` (idempotent) and `export TURBOPACK_ROOT=$(cd {repoPath}/.. && pwd)`; updated `prompt-guard` `worktreeSetup` in `config.local.json`; also updated main repo `next.config.ts` so future worktrees don't need the patch
- **plans/worktree-run-button.md**
- **Review the code changes. Check for bugs, security issues, edge cases, and code quality. Suggest improvements. --- Previous job context: notes/jobs/2026-03-29-plans-security-improvements-md.md**
- **Sort plans on the plan list into groups by status "in review", "ready", "done". Remove the chip since this would be redundant**
- **Add the original prompt to job metadata (escape newlines)**
- **plans/2026-03-30-parent-job-link.md Generate a plan in ./plans for a new feature:**
- **please address these findings --- Previous job context: notes/jobs/2026-03-30-review-the-code-changes-check-for-bugs-security-is.md**
- **Use the plan skill and write the output to ./plans/ For continued tasks we need to show a link back from the job review page to the parent task. We already do this with plans, so we can use the same pattern for this**
- **plans/SECURITY_IMPROVEMENTS.md**
- **was this code merged into our working branch? --- Previous job context: notes/jobs/2026-03-30-plans-2026-03-30-parent-job-link-md-generate-a-pla.md**
- **please merge it --- Previous job context: notes/jobs/2026-03-30-was-this-code-merged-into-our-working-branch-previ.md**
- **please list all the dangling worktrees and their associated jobs**
- **our current diff view is not behaving as expected. is it possible to view only changes made in a job? For worktrees this is easy For non worktrees this is confusing because there may be many active changes in git**

---

## 2026-03-29

- **Ensure default values are coming from the user's settings. See the dispatch page for how this should be implemented. Make sure this is true for the "Plan" dispatch section as well --- Previous job context: notes/jobs/2026-03-29-follow-up-dispatch-on-a-job-needs-to-include-all-t-7.md**
- **Follow up dispatch on a job needs to include all the inputs as on the dispatch page (except repo). Basically an inline dispatch view. use existing components as much as possible (similar to plan view)**
- **plans/2026-03-28-plan-status-linkage.md**
- **Sort jobs within groups by more recent first**
- **Make the color for claude and codex match their respective brands. The colors should be updated across the app, include the Agent selection inputs for the dispatch forms --- Previous job context: notes/jobs/2026-03-29-cleanup-ui-persist-input-box-contents-on-dispatch-.md**
- **Cleanup UI: - Persist input box contents on dispatch page (eg user navigates away and then comes back). This should be seamless (no notifications about saving, just in the background) - Move the chips for repo name on jobs list to the right side (consistency with the task list) - Add the Agent icon (claude or codex) on the left side of the job row (matching the layout of the task items, but replacing the checkbox with the agent icon)**
- **Review dashboard code for improvements on compatibility, code patterns, DRY principles, agent ease-of-use, and documentation**
- **Write this to a ./plan file to address all high and medium findings. Additionally include these notes for item 1: - surface the injected prompt for the dispatch page. Show it above the prompt input box using the same pattern as the "plan" dispatch feature. Shorten it to be more human readable while still conveying the details. Allow the user to clear it - Ensure other dispatch modes do not include this prompt injection eg. editing a plan. Re-starting an existing job is ok --- Previous job context: notes/jobs/2026-03-29-review-dashboard-code-for-improvements-on-compatib.md**
- **Determine why timestamps in the UI are incorrect for Codex jobs, but not Claude**
- **Codex is purple not green. find the exact colors online --- Previous job context: notes/jobs/2026-03-29-make-the-color-for-claude-and-codex-match-their-re.md**
- **dont immediately dispatch plans. take user to dispatch page and show the plan chip**
- **plans/skills-selection-dropdown.md 1. global skills 2. default is no skills 3. just names**
- **Plan skills selection dropdown options when dispatching a task. write the plan to ./plans/**
- **Please write this to a plan for the server changes ./plans/ --- Previous job context: notes/jobs/2026-03-29-review-server-code-for-improvements-on-compatibili.md**
- **Make left tab menu text as secondary**
- **Reframe documentation "no parallelism" from hard principle to current feature status; worktree-based parallel dispatch — *Feedback: the backend already supports parallelism (`ptySessions` is a Map, dashboard has multi-job views). Reviewer routinely dispatches 5-10 jobs in parallel. The real constraints are dashboard UX (watching 5 terminals at once) and git isolation. With worktrees now implemented, the backend supports for parallelism.***
- **There needs to be more of a link between plans and jobs. On a job list item i need to be able to see which plan was used. On a job review in the top right, put the plan name and link to the plan On the plan edit page, show the job name and link to the job, with its status Use sensible defaults for character lengths shown, with concatenation "..."**
- **Main job view is not actively updated. check polling logic and lets make this consistent across the app. Not having a consistently up-to-date dashboard is leading to bad UX**

---

## 2026-03-28

- **Plans dispatch bar redesign** — removed tab toggle from plan detail dispatch bar; extracted shared `DispatchSettingsRow` component reused by both `DispatchView` and `PlanDispatchBar`; bar now shows one shared settings row (agent, model, turns, TUI, auto-merge, worktree) with two inline action rows: Implement (dispatches directly) and Edit Plan (textarea + Start Edit button); settings persist to shared `dispatch-settings` localStorage key

- **Max turns settings fix** — `0` now means no limit in both Settings and Dispatch forms; dispatch always reads from settings default (not persisted); fixed `null ?? 10` bug that ignored explicit "no limit" config

- **hydrate addition context for the existing todos, based on the feedback here: https://share.galexc.io/30d/feedback-for-patrick.md**
- **Headless mode output fixes** — switched plain output mode to `-p --output-format text`, added sentinel-based capture of Claude's response into the job file `## Results` section, persisted `plainOutput` in the sessions API so it survives page refresh, fixed `JobDetailView` to auto-switch to the Review tab when headless, and added a banner in the Terminal tab explaining the mode
- **repo name under each job should be colored chips, to match how tasks are shown**
- **Plans tab feature** — added Plans view (list, detail, edit, rich markdown) with repo filter persisted to localStorage; status linkage writes `Dispatched:` + `Job:` metadata to plan files on dispatch; plan path chip in dispatch form replaces full content pre-fill; job status chips on plan cards resolve live against swarm agents; added `parsePlansDir`, `writePlanDispatch` to parsers.js; design rule added to coding-standards.md for persisting UI filter state
- **Diff-without-worktree plan** — drafted plan for showing per-job diffs when not using worktrees; written to `plans/diff-without-worktree.md`
- **dispatched tasks aren't started until the terminal view is opened by the user (when worktree is off, TUI disabled)**
- **Dispatch button and node-pty fixes** — fixed dispatch button doing nothing (repo state not set when overview loads late); fixed dispatch not navigating to job terminal after submit; added inline error display for dispatch failures; diagnosed and fixed node-pty `posix_spawnp failed` caused by prebuild `spawn-helper` missing execute permissions (Node v24 rebuild fails silently, falls back to prebuild with wrong perms)

- **Rewrote README for open source release** — rewrote intro, principles, setup, and how-it-works sections with anti-ai-writing pass; added "What it's not" section (vs OpenClaw, Devin, Linear, Copilot Workspace), security section (0 CLI deps, 15 dashboard deps, localhost-only), centered header with GIF. Drafted launch messages (DM + Twitter post) to `launch-messages.md`.

---

## 2026-03-26

- **Multi-agent dispatch + Settings UI** — added Codex CLI support alongside Claude, per-agent settings panel (model, max turns, skip permissions, extra flags), reusable Toggle component, dynamic model fetching from CLI/keychain, plain output (-p) toggle, and dispatch button redesign with pill shape and hover animation

---

## 2026-03-27

- **Loading page + dispatch button glow** — added `/loading` fullscreen route with animated Dispatch button, soft blur-based glow, auto-clicking cursor that arcs in from bottom-left along a Bézier path and fades out in place; applied same glow to the dispatch page button, active only when the form is ready to submit
- **OpenClaw agent plan** — researched CLI interface, tested `openclaw agent` locally, investigated permissions model (`exec-approvals.json`), and wrote implementation plan to `plans/openclaw-agent.md`
- **Dashboard UI polish** — moved worktree toggle to its own row right of branch select; updated page title and favicon to Dispatch/Send icon; applied foreground-secondary color to task category text; removed redundant status chip from task rows (already grouped by status); added green border highlight on hover for job and task rows via inline event handlers

- **Write this to the necessary files in .claude/references and gitignore that folder --- Previous job context: notes/jobs/2026-03-26-use-the-startup-strategy-council-skill-to-develop-.md**
- **Renamed app to Dispatch** — updated CLAUDE.md, README.md, dashboard header, package.json, and all skills (workdown → dispatch skill folder, add-repo references)
- **Flip `SkipPermissions` from default-on to explicit opt-in. the default in settings should be off**
- **Use my existing script "notes/promo-video-script.md" to write a /plan to implement a remotion video using the /remotion skill. I will provide the .mp4 files, you can help by also including the list of videos I need to make with suggestions about content.**
- **Toggle rewrite + TUI mode + worktree fixes** — rewrote Toggle as label/checkbox with inline styles; added per-agent TUI mode setting (Claude: -p, Codex: --quiet) to settings and dispatch; fixed plainOutput not forwarding through App.jsx; wired useWorktree flag end-to-end; fixed worktree cleanup on kill/reject/session-fail; removed 6 orphaned worktree directories; suppressed git stderr noise in server logs; added repo identity colors for dispatch and prompt-guard

---

## 2026-03-26

- **Add worktree review visibility** — added diff endpoint, branch badge, DiffSummary component, and merge CTA restructure to Review tab; merged job branches into main via cherry-pick; fixed createCheckpoint branch name bug; 85 tests passing
- **Please review the feedback in https://share.galexc.io/30d/feedback-for-patrick.md and add actionable item to the todo list.**
- **Migrated clauffice to global install** — added --global mode to install.sh symlinking into ~/.claude/; removed per-repo clauffice submodules from all Scribular repos; reverted work-down .claude/ to real files; standardized .claude/settings.local.json in all root .gitignores
- **Currently the terminal tab must be opened by the user for a job to actually kick off. Is Claude Code doing this to enforce usage only in viewable terminals? Would using the -p flag fix this? Or is it something simple causing the issue?**
- **Add unit tests for parsers.js**
- **Please validate if the added test suite meets our coding quality standards for brevity, coverage --- Previous job context: notes/jobs/2026-03-26-add-unit-tests-for-parsers-js.md**
- **Please review the new tests in parsers.test.js for accuracy, and coverage.**
- **Please create a plan for integration testing --- Previous job context: notes/jobs/2026-03-26-please-validate-if-the-added-test-suite-meets-our-.md**
- **Validate this plan and identify areas we could improve --- Previous job context: notes/jobs/2026-03-26-please-create-a-plan-for-integration-testing-previ.md**
- **Use `git worktree add` per dispatched job to isolate branches and prevent git state collisions**
- **Please update the plan with these changes, and then execute the plan --- Previous job context: notes/jobs/2026-03-26-validate-this-plan-and-identify-areas-we-could-imp.md**
- **Review the current state and fix any remaining problems or issues. Use this review as your guide. --- Previous job context: notes/jobs/2026-03-26-review-the-code-changes-check-for-bugs-security-is.md**
- **Review the code changes. Check for bugs, security issues, edge cases, and code quality. Suggest improvements. --- Previous job context: notes/jobs/2026-03-26-use-git-worktree-add-per-dispatched-job-to-isolate.md**
- **All the timestamp tags in the review view say "Just Now" instead of 1m or 3m ago**
- **In the task list, clicking to edit a task sometimes scrolls me down the page. i cannot click to edit them. investigate.**
- **Determine if there will be conflicts if two machines are running the dashboard, and managing the same todo files. Eg separate backends, but same markdown files.**
- **Please use agent-browser and /frontend-design and /behavioral-product-design to review the current review page for a few of our latest jobs. There are a lot of improvements than can be made to improve this view and make it easier for the user to understand what happened, what changed, and what next steps are.**
- **Please implement this plan --- Previous job context: notes/jobs/2026-03-26-please-use-agent-browser-and-frontend-design-and-b.md**

---

## 2026-03-25

- **Make the app logo green**
- **Make the Terminal and Review tabs also highlighted when active like the left panel**
- **Update the app logo to green**

---

## 2026-03-24

- **Initial setup** — configured repos, started dashboard

        