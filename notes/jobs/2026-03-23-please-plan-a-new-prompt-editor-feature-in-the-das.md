# Job Task: Please plan a new prompt-editor feature in the dashboard. This is where we can add/edit prompts to use in dispatch and follow-up dispatch.
Started: 2026-03-23 18:13:29
Status: Completed
ResumeId: ba12cea2-760f-4571-b8a7-fff010922d85
ResumeCommand: claude --dangerously-skip-permissions --resume "ba12cea2-760f-4571-b8a7-fff010922d85"
Validation: Validated
Repo: hub
Session: session-b3bc60f5-78e0-4eb3-911d-bd94c89be556
SkipPermissions: true
Model: claude-opus-4-6
MaxTurns: 10
BaseBranch: github-integration

## Progress
- [2026-03-23 18:13:29] Task initiated from dashboard
- [2026-03-23 18:14:00] Explored DispatchView, SchedulesView, ResultsPanel (FollowUpChat), ActivityBar, App.jsx, useAppNavigation, constants.js, server.js prompts/schedules endpoints
- [2026-03-23 18:15:00] Plan written

## Results

### Prompt Editor — Feature Plan

---

#### Problem

Dispatch prompts are currently either typed from scratch in the `DispatchView` textarea, or chosen from 6 hardcoded `FOLLOWUP_TEMPLATES` in `constants.js` (Code Review, Iterate, Write Tests, Fix Issues, Update Docs, Cleanup). There's no way to:

1. **Save** a prompt you've written so you can reuse it later
2. **Edit** existing template prompts (the hardcoded ones can't be customized)
3. **Organize** prompts by purpose, repo, or category
4. **Share** prompts across dispatch and follow-up dispatch contexts

Users end up retyping similar prompts or losing good ones after dispatching.

---

#### Design Principles

- **Extend, don't replace.** The current dispatch and follow-up flows work. The prompt editor feeds into them — it doesn't rebuild them.
- **Same patterns.** Follow the SchedulesView CRUD pattern (JSON file on disk, REST API, React list+form). No new infrastructure.
- **Minimal surface.** No separate "prompts" nav tab. Prompts are a *library* that appears inline inside DispatchView and FollowUpChat.
- **Save at the moment of value, not before.** Prompt saving happens *after* dispatch succeeds (when the user has gotten value and feels ownership), not before (when they're focused on dispatching). This avoids the present-bias trap.
- **Self-organizing by usage.** Prompts sort by recency, not creation order. The library reflects actual workflow and creates loss aversion as users build up "their" collection.

---

#### Data Model

Stored in `prompts.json` at hub root (same pattern as `schedules.json`):

```json
[
  {
    "id": "prompt-1711234567890",
    "name": "Deep code review",
    "prompt": "Review the code changes thoroughly. Check for bugs, security issues, edge cases, and code quality. Suggest concrete improvements with code examples.",
    "category": "review",
    "repo": null,
    "created": "2026-03-23T18:00:00.000Z",
    "updated": "2026-03-23T18:00:00.000Z",
    "lastUsed": "2026-03-23T18:30:00.000Z",
    "useCount": 5
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID, `prompt-` + timestamp |
| `name` | string | Short label shown in chips/list |
| `prompt` | string | Full prompt text |
| `category` | string \| null | Optional grouping: `"dispatch"`, `"followup"`, `"review"`, or custom |
| `repo` | string \| null | Optional repo filter — if set, only shows when that repo is selected |
| `created` | ISO string | Creation timestamp |
| `updated` | ISO string | Last edit timestamp |
| `lastUsed` | ISO string \| null | Updated each time the prompt is used in dispatch or follow-up. Drives recency sort. |
| `useCount` | number | Incremented on each use. Future signal for "most used" display. |

The hardcoded `FOLLOWUP_TEMPLATES` in `constants.js` become **seed data** — on first load, if `prompts.json` doesn't exist, populate it with those 6 templates. After that, they're user-editable like any saved prompt.

---

#### API Endpoints (server.js)

Follow the exact `schedules` CRUD pattern:

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/api/prompts` | — | List all saved prompts (sorted by `lastUsed` desc, nulls last) |
| `POST` | `/api/prompts` | `{ name, prompt, category?, repo? }` | Create a new prompt |
| `PUT` | `/api/prompts/:id` | `{ name?, prompt?, category?, repo? }` | Update a prompt |
| `PATCH` | `/api/prompts/:id/use` | — | Bump `lastUsed` to now, increment `useCount`. Called when a prompt is dispatched. |
| `DELETE` | `/api/prompts/:id` | — | Delete a prompt |

Implementation: ~50 lines, copy the `loadSchedules`/`saveSchedules` pattern with `loadPrompts`/`savePrompts` and a `PROMPTS_FILE` constant. GET returns prompts sorted by `lastUsed` (most recent first, nulls last).

---

#### UI Changes

##### 1. Prompt Library in DispatchView (`DispatchView.jsx`)

Add a **prompt picker** between the repo/branch row and the textarea:

```
┌─────────────────────────────────────────────────┐
│ Repository: [hub] [electron] [marketing] ...    │
│ Branch: [main ▼]                                │
│                                                 │
│ Prompts:  (sorted by most recently used)        │
│ ┌───────────┐ ┌──────────┐ ┌────────┐ ┌──────┐ │
│ │Deep Review│ │Write Tests│ │Iterate │ │Fix ··│ │
│ └───────────┘ └──────────┘ └────────┘ └──────┘ │
│                                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ Pre-filled with last-used prompt for repo   │ │
│ │ (user can edit or clear)                    │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ Model: [Opus ▼]  Turns: [10]  Auto-merge  [Dispatch] │
│                                                 │
│  ── after dispatch succeeds, if prompt is new ──│
│ ┌─────────────────────────────────────────────┐ │
│ │ 💾 Save "Review the code changes..." ?      │ │
│ │    Name: [Deep code review    ]  [Save]     │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

Behavior:
- Fetch prompts on mount via `GET /api/prompts` (returned sorted by `lastUsed` desc)
- Filter by selected repo (show prompts where `repo === null` or `repo === selectedRepo`)
- Clicking a prompt chip fills the textarea and calls `PATCH /api/prompts/:id/use` to track usage
- **Pre-fill:** When a repo is selected, auto-fill the textarea with the most recently used prompt for that repo (the first chip). User can edit or clear it. Reduces cold-start blank textarea friction.
- **Save-after-dispatch:** No `+ New` button in the chip row. Instead, after a successful dispatch, if the dispatched text doesn't match an existing saved prompt, show an inline suggestion below the textarea: *"Save this prompt for reuse?"* with an auto-generated name (first ~40 chars of prompt) and a single "Save" button. One click to save, dismiss to skip.
- **Edit/delete on hover:** Each chip shows a `···` icon on hover (right edge). Clicking it reveals a small popover with Edit and Delete options. No long-press or right-click discovery required.

##### 2. Prompt Library in FollowUpChat (`ResultsPanel.jsx`)

Replace the hardcoded `FOLLOWUP_TEMPLATES.map(...)` with the same saved prompts:

```
Continue as New Job
┌───────────┐ ┌──────────┐ ┌────────┐ ┌──────┐
│Deep Review│ │Write Tests│ │Iterate │ │Fix ··│
└───────────┘ └──────────┘ └────────┘ └──────┘
```

Same fetch, same filtering by repo, same recency sort. Same save-after-dispatch pattern — after follow-up dispatch succeeds, offer to save the prompt if it's new.

##### 3. Shared PromptLibrary Component

Extract a reusable component used by both DispatchView and FollowUpChat:

**`dashboard/src/components/PromptLibrary.jsx`**

```jsx
// Props:
//   repo: string — currently selected repo, used to filter
//   onSelect: (promptText, promptId) => void — called when user picks a prompt; parent calls PATCH /use
//   activeId: string | null — currently selected prompt ID for highlight
//   compact: boolean — true for follow-up (smaller chips), false for dispatch
//   showSaveOffer: { text: string } | null — set by parent after dispatch succeeds with unsaved text
//   onSaved: () => void — callback after save completes (clears the offer)
```

Responsibilities:
- Fetches `GET /api/prompts` (with local cache/refresh), renders sorted by `lastUsed`
- Renders chips filtered by repo, with `···` hover icon for edit/delete
- Handles edit/delete via popover on `···` click
- When `showSaveOffer` is set, renders inline save suggestion with auto-generated name + "Save" button
- New chip appears with a brief highlight animation (subtle glow, 500ms fade) to confirm save

##### 4. No New Nav Tab

The prompt library is **embedded** inside DispatchView and FollowUpChat — not a separate view. This keeps navigation clean (5 tabs is already plenty) and puts prompts where they're used.

---

#### File Changes Summary

| File | Change | Lines (est.) |
|------|--------|-------------|
| `dashboard/server.js` | Add Prompts CRUD + PATCH `/use` endpoint + `loadPrompts`/`savePrompts` + seed logic | ~65 |
| `dashboard/src/components/PromptLibrary.jsx` | **New file** — shared prompt chips (recency-sorted, hover `···`, save-offer, highlight animation) | ~170 |
| `dashboard/src/components/DispatchView.jsx` | Import PromptLibrary, add between branch row and textarea, pre-fill on repo change, save-offer state after dispatch | ~25 |
| `dashboard/src/components/ResultsPanel.jsx` | Replace `FOLLOWUP_TEMPLATES.map(...)` with PromptLibrary, save-offer after follow-up dispatch | ~20 |
| `dashboard/src/lib/constants.js` | Keep `FOLLOWUP_TEMPLATES` as seed data source (or move to server.js seed function) | ~0 |
| `docs/dashboard-architecture.md` | Add PromptLibrary to component tree | ~3 |

**Total: ~280 lines of new/changed code. 1 new file.**

---

#### Implementation Order

1. **Server endpoints** — Add CRUD + `PATCH /use` to `server.js` with seed-from-FOLLOWUP_TEMPLATES logic. GET returns sorted by `lastUsed` desc.
2. **PromptLibrary component** — Build shared chip picker: recency-sorted, hover `···` for edit/delete popover, `showSaveOffer` prop for post-dispatch save suggestion, highlight animation on new save.
3. **Wire into DispatchView** — Add PromptLibrary between branch selector and textarea. Pre-fill textarea with most recently used prompt when repo changes. After successful dispatch, set `showSaveOffer` if prompt text doesn't match a saved prompt.
4. **Wire into FollowUpChat** — Replace hardcoded template chips with PromptLibrary. Same save-after-dispatch pattern.
5. **Test end-to-end** — Use a prompt, verify recency sort updates, dispatch and verify save offer appears, save and verify chip appears with highlight, edit/delete via hover menu, verify repo filtering and pre-fill.

---

#### Behavioral Design Rationale

These changes were added after a behavioral product design review:

| Change | Principle | Why It Matters |
|--------|-----------|----------------|
| Save-after-dispatch (not before) | Present bias / endowment effect | Users in dispatch mode won't stop to name and save. After dispatch, they've gotten value and feel ownership — saving takes one click. |
| `lastUsed` + recency sort | Loss aversion | A self-organizing library reflects the user's actual workflow. Over time they feel "I've built up my collection" — creating switching cost. |
| Pre-fill textarea from last-used | Anchoring / habit loop | Blank textarea = decision friction every visit. Pre-filling with last-used prompt for that repo reduces activation energy and creates a cue→action loop. |
| Hover `···` for edit/delete | Discoverability | Long-press/right-click is a hidden affordance. Hover overflow icon is the standard pattern (Notion, Linear, Figma) — zero discovery needed. |
| Chip highlight animation on save | Celebration / reinforcement | Brief visual confirmation that the save happened and the library grew. Reinforces the investment behavior. |

---

#### What This Doesn't Include (intentionally)

- **Prompt variables/templating** (e.g., `{{repo}}`, `{{branch}}`). The current system passes plain text. Variables can be added later if needed.
- **Import/export** of prompts. The JSON file is already portable.
- **Prompt versioning/history**. Overkill for this stage.
- **Categories as a first-class filter UI**. The `category` field is stored but the UI just shows a flat chip list. Grouping can be added if the list grows large.
- **Search within prompts**. Not needed until the list exceeds ~20 items.

## Validation
