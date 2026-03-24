# Job Task: /behavioral-product-design, review the plan --- Previous job context: notes/jobs/2026-03-23-please-plan-a-new-prompt-editor-feature-in-the-das.md
Started: 2026-03-23 18:27:05
Status: Completed
Validation: Validated
Repo: hub
OriginalTask: /behavioral-product-design, review the plan
Session: session-9cfd571f-7b84-4c2b-bead-7da8af54e9aa
SkipPermissions: true
Model: claude-opus-4-6

## Progress
- [2026-03-23 18:27:05] Task initiated from dashboard
- [2026-03-23 18:27:30] Read plan, DispatchView, ResultsPanel, constants.js — understood current UX
- [2026-03-23 18:28:00] Behavioral product design review written

## Results

### Behavioral Product Design Review: Prompt Editor Plan

---

#### Overall Assessment

The plan is architecturally solid — clean CRUD, reuse of the schedules pattern, embedded inline rather than a separate nav tab. These are good instincts. But viewed through a behavioral lens, the plan has **one strong design** (the follow-up templates becoming editable) and **several gaps** where behavioral principles could dramatically improve adoption and habit formation.

**Grade: B+** — Good bones, needs behavioral refinement before build.

---

#### What the Plan Gets Right

**1. Status quo effect — smart default migration**
Converting `FOLLOWUP_TEMPLATES` into editable seed data is excellent behavioral design. Users who already rely on "Code Review" / "Iterate" / "Write Tests" won't lose their existing behavior — they get the same chips in the same place, now editable. This respects the **status quo bias** (people prefer their current state) while unlocking new capability. No one is forced to change.

**2. No new nav tab — reducing choice overload**
Embedding the prompt library inline avoids the **paradox of choice** problem. A separate "Prompts" tab creates a decision: "Should I go configure prompts first, or just dispatch?" That question kills momentum. Inline placement keeps prompts at point-of-use, which is the correct friction-reducing choice.

**3. Chip-based selection — low commitment interaction**
Clicking a chip to fill a textarea is a low-friction, low-commitment interaction. Users can click, read what fills in, edit it, then dispatch. There's no modal, no multi-step wizard. This aligns with **progressive disclosure** — show the simple thing, let users go deeper if they want.

---

#### Behavioral Gaps & Recommendations

**Gap 1: The "Save" action has too much friction — users won't do it**

The plan says clicking `+ New` opens "an inline save dialog (name + optional category)." This creates a **present bias** problem: the user is in dispatch mode, they've just crafted a good prompt, they want to *send it now*. Stopping to name it, categorize it, and save it is a future-oriented action (benefiting future-you) competing with a present-oriented action (dispatching now). Present bias means dispatch wins almost every time.

**Recommendation: Save-after-dispatch, not save-before-dispatch.**

After a successful dispatch, show a brief toast or inline prompt: *"Save this prompt for reuse?"* with a pre-filled name derived from the first ~40 characters of the prompt. One click to save. This leverages the **endowment effect** — the user just used this prompt and got value from it, so they now feel ownership over it. They're much more likely to save something they've already used than something they *might* use later.

Implementation: After `handleDispatch` succeeds, if the dispatched prompt doesn't match an existing saved prompt, show a save suggestion with auto-generated name. Single "Save" button. No category picker (auto-detect or leave null).

**Gap 2: No recency signal — violates the "seven-day loss aversion" principle**

Jackson Shuttleworth's insight: "Once you hit seven days, loss aversion kicks in." The prompt library as designed is a flat list of chips sorted by... nothing specified. There's no signal of which prompts are *working for you* — which ones you use often, which you used recently. Without this signal, the library feels like dead storage rather than a living tool.

**Recommendation: Add `lastUsed` timestamp and sort by recency.**

When a user clicks a prompt chip, update its `lastUsed` field. Sort prompts by `lastUsed` (most recent first). This creates a natural, self-organizing list that reflects actual usage. Over time, the user sees "their" prompts at the front — creating **loss aversion** around their personalized library. "I've built up this collection of prompts that works for me" is something they'd feel losing if they stopped using the dashboard.

Data model addition:
```json
{ "lastUsed": "2026-03-23T18:30:00.000Z", "useCount": 5 }
```

Cost: ~5 lines in server.js (PATCH on use), ~2 lines in the component (sort before render). Very cheap for significant behavioral impact.

**Gap 3: The "edit/delete" interaction (long-press / right-click) is invisible**

"Long-press or right-click a chip → edit/delete options" is a **hidden affordance**. Most users will never discover this. In behavioral design, if an action is important for building ownership and investment, it needs to be visible.

**Recommendation: Show edit/delete on hover, not on long-press.**

On hover, show a tiny `···` overflow icon on the chip's right edge. Click it to reveal edit/delete. This is the standard pattern in every modern app (Notion, Linear, Figma) and requires zero discovery. Long-press is a mobile pattern that doesn't translate to desktop dashboards.

For mobile/touch: the `···` icon is always visible (no hover state), or tap-and-hold is fine as a *secondary* gesture.

**Gap 4: No "last used prompt" default — cold start on every visit**

When the user opens DispatchView, the textarea is empty. They must either type from scratch or click a saved prompt. This is a cold start problem that creates **decision friction** every time. "What should I dispatch? Let me think..."

**Recommendation: Pre-fill with the most recently used prompt for the selected repo.**

When the user selects a repo, auto-fill the textarea with the last prompt they dispatched to that repo (from `lastUsed` + repo filtering). They can edit or replace it, but the starting state isn't blank. This leverages **anchoring** — the last thing you did is a reasonable guess for what you'll do next, especially in a workflow tool where tasks are often repetitive.

This also creates a subtle **habit loop**: Open dashboard → see your last prompt ready → tweak and dispatch → done. The cue (opening dispatch) leads directly to a near-complete action, reducing the activation energy.

**Gap 5: No celebration/confirmation moment after save**

The plan has no feedback moment when a prompt is saved. Kristen Berman's "pause moments" principle says micro-celebrations reinforce the behavior you want to encourage (in this case, building a prompt library). Without feedback, saving feels like nothing happened.

**Recommendation: Brief visual confirmation when a prompt is saved.**

When a prompt is saved, the new chip should appear in the list with a brief highlight animation (a subtle glow or scale-up that fades after 500ms). This serves dual purposes: it confirms the save happened, and it draws attention to the growing library — reinforcing the **investment** the user is making.

---

#### Priority-Ordered Changes

| Priority | Change | Effort | Behavioral Impact |
|----------|--------|--------|-------------------|
| **P0** | Add `lastUsed` + `useCount` to data model; sort by recency | ~10 lines | Loss aversion, self-organizing library |
| **P0** | Save-after-dispatch flow (toast/inline suggestion) | ~30 lines | Eliminates present bias barrier to saving |
| **P1** | Pre-fill textarea with last-used prompt per repo | ~10 lines | Reduces cold start friction, creates habit loop |
| **P1** | Hover `···` for edit/delete instead of long-press | ~15 lines | Makes investment actions discoverable |
| **P2** | Chip highlight animation on save | ~5 lines CSS | Celebration moment reinforces saving behavior |

---

#### What to Explicitly NOT Add (the plan got this right)

- **No categories UI** — The plan stores `category` but doesn't build filter UI. Correct. Categories add decision overhead ("is this a 'review' prompt or a 'dispatch' prompt?") without clear benefit at small scale. Recency-based sorting is a better organizing principle.
- **No search** — Correct for now. With recency sorting, the top 3-4 prompts are the ones you use. Search is only needed at 20+ items.
- **No variables/templating** — Correct. This adds complexity that feels powerful but rarely gets used. Plain text with manual editing is simpler and more flexible.

---

#### Summary: Three Things to Change Before Building

1. **Save-after-dispatch, not save-before.** Move the save moment to *after* the user has gotten value from the prompt. This is the single biggest behavioral improvement — without it, few users will ever save prompts.

2. **Track usage, sort by recency.** Add `lastUsed` and `useCount`. This turns a static list into a living tool that reflects the user's actual workflow, creating loss aversion and investment.

3. **Pre-fill from last-used.** Remove the cold-start blank textarea by anchoring on the last prompt used for that repo. Reduces activation energy on every visit.
