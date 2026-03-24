# Dashboard URL Routing + Route History Plan

Date: 2026-03-21
Owner: Hub dashboard
Status: Planned

## Goal
Move dashboard navigation from local component state to URL-based routing so deep links, refresh persistence, and browser back/forward history work predictably.

## Current State
- Navigation state is in `useAppNavigation` (`activeNav`, `drillDownJobId`), not URL-based.
- `activeNav` is persisted in `localStorage` (`hub:activeNav`).
- Detail view is rendered by state overlays in `App.jsx`.
- Browser history cannot represent in-app transitions.

## Target State
- URL is source of truth for page and selected job.
- Browser back/forward navigates between dashboard views and job detail correctly.
- Direct links open the correct view (`/jobs/:jobId`, `/tasks`, etc.).
- Existing UI behavior remains otherwise unchanged.

## Route Map (Proposed)
- `/` -> redirect to `/tasks`
- `/status`
- `/jobs`
- `/jobs/:jobId`
- `/tasks`
- `/dispatch`
- `/schedules`

## Implementation Plan

### PR1: Routing Scaffold (No Behavior Change)
1. Add `react-router-dom` dependency.
2. Wrap app root with `BrowserRouter`.
3. Add top-level `Routes` in `App.jsx` with route map above.
4. Preserve current layout shell (`HeaderBar`, `ActivityBar`, `CommandPalette`, `Toast`) while routing only main content.
5. Add index redirect from `/` to `/tasks`.

Acceptance:
- App boots and renders all existing main tabs via direct URL navigation.
- Reload on `/status`, `/tasks`, `/dispatch`, `/schedules`, `/jobs` opens correct screen.

### PR2: Replace State Navigation with `navigate`
1. Replace `useAppNavigation` navigation actions with router-backed helpers.
2. Update `ActivityBar` tab clicks to navigate to route paths.
3. Update command palette actions and search selection to use route navigation.
4. Remove `hub:activeNav` localStorage dependency (route is source of truth).

Acceptance:
- Switching tabs updates URL.
- Back/forward traverses tab transitions.

### PR3: Job Detail Route (`/jobs/:jobId`)
1. Replace `drillDownJobId` overlay gating with route param.
2. Ensure all "open job" actions navigate to `/jobs/:jobId`.
3. Ensure back action from detail returns to `/jobs` (or prior history location).
4. Keep current terminal/review tab logic inside detail component intact.

Acceptance:
- Deep-linking to a job works.
- Refresh on `/jobs/:jobId` keeps detail open.
- Back returns to previous location with expected history behavior.

### PR4: Edge Cases + Polish
1. Handle unknown routes with a not-found redirect or fallback screen.
2. Handle missing/deleted job IDs gracefully on `/jobs/:jobId`.
3. Validate command palette and keyboard shortcuts still work across routes.
4. Confirm no regressions in dispatch-to-detail flow and follow-up flow.

Acceptance:
- Invalid route behavior is deterministic.
- Missing job detail shows clear error and recovery path.

## Non-Goals
- No backend API contract changes.
- No redesign of page layout.
- No major refactor of polling/session store in this effort.

## Risks
- Regression in job-detail overlay assumptions previously tied to local state.
- Route and polling race conditions when opening just-created jobs.
- Browser refresh on detail view before session mapping is hydrated.

## Mitigations
- Keep PRs small and sequential.
- Add targeted smoke checks after each PR.
- Maintain existing data-fetch/polling APIs; route only controls view selection.

## Validation Checklist
- Navigate each tab via sidebar and direct URL.
- Browser back/forward across mixed tab/detail transitions.
- Open job from Jobs list, Tasks list, and search results.
- Follow-up dispatch opens new `/jobs/:jobId` session detail.
- Resume action and error handling still function under route-based detail.
- Hard refresh on job detail preserves context.

## Suggested File Touch List
- `dashboard/package.json`
- `dashboard/src/main.jsx` (or current root entry)
- `dashboard/src/App.jsx`
- `dashboard/src/lib/useAppNavigation.js` (replace/remove)
- `dashboard/src/components/ActivityBar.jsx`
- `dashboard/src/components/CommandPalette.jsx`
- `dashboard/src/components/JobsView.jsx`
- `dashboard/src/components/AllTasksView.jsx`
- Any helper modules that currently call `openJobDetail` / `setActiveNav`

## Resume Notes
Start at PR1 with dependency + route scaffold only. Do not combine PR2/PR3 in the same pass.
