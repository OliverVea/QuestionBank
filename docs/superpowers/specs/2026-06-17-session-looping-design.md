# Session Looping — Design Spec

**Date:** 2026-06-17
**Status:** Approved (brainstorming + mock walkthrough completed).
**Backs:** TODO section 19 (19c session counter, 19d pause screen, 19e configurable interval). 19a/19b looping behavior already exists.
**Mock:** `docs/mocks/session-pause.html` + `docs/mocks/session-pause.css` (approved 2026-06-17).

## Goal

Give the Learn and Practice loops a sense of a **session**: a running count of items
completed, and a deliberate, encouraging **pause checkpoint** where the user can rest or
keep going. The item-to-item flow itself is unchanged.

The loop already works: after grading, the grade page returns to `#/learn` or `#/revisit`,
which fetches the next item via `loadNext()` until "All caught up!". This feature layers a
session counter and pause screen on top of that existing flow — it does not rebuild it.

## Resolved decisions

- **Scope = the session shape, not the loop.** Counter (19c) + pause screen (19d) +
  configurable Practice interval (19e). No change to how items are fetched or graded.
- **Session state = an in-memory client singleton** (`packages/client/src/lib/session.ts`).
  No persistence, no server session lifecycle. Accepted tradeoff: the count is lost on a
  full page reload / PWA relaunch. Chosen for simplicity.
- **Counts are SEPARATE per mode** — an independent `learn` count and `revisit` count.
- **Pause trigger differs per mode** (Practice can't group by chapter — it interleaves due
  items across books by SRS urgency):
  - **Learn = chapter boundary.** Pause when the next item's chapter differs from the
    just-completed item's chapter (the seam). Chapter = first dotted-path segment of the
    label, via the existing `splitLabel(label).chapter` in `lib/problem-grouping.ts`.
  - **Practice = every N items**, where N is the configurable `pauseEvery` setting.
- **"Keep going" does NOT reset the count.** The pause is a mid-session checkpoint; the
  count keeps climbing across pauses. Only **"Take a break"** (ending the session) resets
  that mode's count. A full reload also clears it (in-memory).
- **Practice interval is configurable now (19e), via a DEDICATED new setting** — NOT a reuse
  of the weekly `problemsGoal` (that is a weekly volume target; the pause interval is a
  per-session break cadence — different concept). New settings field `pauseEvery`, default 10.
- **Per-mode accent color** on the pause screen: Learn = `--learn` (green), Practice =
  `--revisit` (purple). Medallion, count number, and primary button read the mode accent.
- **Only the count label differs per mode** ("problems this session" vs "reviews this
  session"); the headline names the milestone ("Chapter 1 done!" vs "Nice — N reviews done!").

## Components

### `lib/session.ts` (new) — the session singleton

Module-level state, two independent records:

```ts
type Mode = 'learn' | 'revisit';
interface ModeSession { count: number; lastChapter: string | null; }
// module-level: { learn: {...}, revisit: {...} }

/** Record one completed item. For learn, pass the completed item's chapter. */
function recordCompleted(mode: Mode, chapter?: string | null): void;

/** The running count for a mode (for the pause screen + any inline counter). */
function getCount(mode: Mode): number;

/**
 * Should we pause before showing `next`?
 *  - learn: true when next item's chapter differs from the last completed chapter
 *    (and a previous item exists). nextChapter passed by the caller.
 *  - revisit: true when count > 0 and count % pauseEvery === 0.
 */
function shouldPause(mode: Mode, opts: { nextChapter?: string | null; pauseEvery?: number }): boolean;

/** End the session for a mode — zeroes count and clears lastChapter. */
function reset(mode: Mode): void;
```

All pause logic lives here; the pages stay thin. `lastChapter` is only meaningful for
learn. Seam detection compares the *just-recorded* chapter against the *incoming* next
item's chapter — so `recordCompleted` is called when an item is finished (on return from
grade), and `shouldPause` is consulted when the next item loads.

### `SessionPause` component (new) — `components/SessionPause.ts` (+ `.css`)

Ports the mock. Props:

```ts
interface SessionPauseProps {
  mode: 'learn' | 'revisit';
  count: number;
  /** Milestone headline, e.g. "Chapter 1 done!" or "Nice — 10 reviews done!". */
  title: string;
  onContinue: () => void;  // load next item; count NOT reset
  onBreak: () => void;     // reset(mode); navigate home
}
```

Renders the centered celebration card: accent medallion, headline, subline, count tally
(big number + per-mode label), and the two side-by-side rounded buttons (grey "Take a
break" left, accent "Keep going" right). Accent is set by `mode` (green/purple).

### LearnPage / RevisitPage (modified)

Both already own a `loadNext()` and a render flow. The completion itself is recorded by the
grade page at save time (see Data flow), NOT by these pages. The change in each:

1. In `loadNext()`'s success path, before rendering the next question, derive the next
   item's chapter (`splitLabel(nextLabel).chapter`) and consult
   `shouldPause(mode, { nextChapter, pauseEvery })`. `pauseEvery` is irrelevant for learn;
   for revisit the RevisitPage fetches it once via `GET /api/settings` on mount (the page does
   not fetch settings today, so this is a new, single fetch — cached for the page's lifetime).
2. If `shouldPause` is true, render `SessionPause` instead of the question card. The page
   builds the headline string (learn: `"Chapter ${lastChapter} done!"` using the singleton's
   `lastChapter`; revisit: `"Nice — ${getCount('revisit')} reviews done!"`). `onContinue`
   renders the already-fetched next question (no refetch, count untouched); `onBreak` calls
   `reset(mode)` and navigates to `#/`.
3. The "All caught up!" terminal state is unchanged (it is itself a natural session end);
   on reaching it the page resets the mode session so the next visit starts fresh.

### Settings (modified) — `pauseEvery`

- Server `Settings` type + storage record gain `pauseEvery: number` (default 10).
- `GET/PUT /api/settings` carry it; PUT validates it as an integer ≥ 1 (mirroring the
  existing `daysGoal`/`problemsGoal` guards). Default applies when absent (back-compat with
  records written before this field existed).
- `SettingsPage` gains a third bare number field ("Pause every … reviews"), following the
  existing baseline-fetch + dirty-tracking pattern.

## Data flow

The completed item's chapter must survive the grade round-trip (LearnPage → `#/grade` →
back). Two options; the spec picks the simpler:

- The grade page already navigates back with `from=learn|revisit`. Extend the return so the
  completed question's label (hence chapter) is available to the page on return — either via
  a query param on the return hash, or by having the session singleton record the completion
  at grade-save time (the grade page imports `session.recordCompleted`). **Decision:** record
  at grade-save time in the grade page — it is the moment an item is truly "completed" (a
  skip is not a completion), and it keeps Learn/Practice from needing to reconstruct what was
  just finished. The grade page knows its `from` mode and the question's label.

So: grade save → `recordCompleted(from, chapterOfThisQuestion)` → navigate to `#/${from}` →
that page's `loadNext()` fetches the next item → `shouldPause(...)` decides pause vs render.

Skips do not count and do not reset; they are not completions.

## Error handling

- Network/load errors keep the existing `renderError()` path — the pause logic only runs on
  the success path of `loadNext()`, so a failed fetch never strands the user on a pause.
- Settings PUT validation failure → 400, surfaced inline on the Settings page (existing
  save-error pattern from the prior settings build).
- A missing/zero `pauseEvery` defaults to 10 server-side, so the client always receives a
  sane interval.

## Testing

Per the project's high-level test strategy:

- **`lib/session.test.ts`** (client unit — justified because it is pure logic with branchy
  rules): seam detection (same chapter → no pause, changed chapter → pause, first item → no
  pause), revisit modulo (pause at multiples of `pauseEvery`, not between), continue keeps the
  count, break resets it, modes independent.
- **api-uat** (server): `pauseEvery` round-trips through `GET`/`PUT /api/settings`, defaults
  to 10 when unset, and is rejected (400) when invalid — extending the existing settings UAT.
- Manual: run the app, do a Learn session across a chapter boundary (pause appears, continue
  keeps counting, break resets), and a Practice session of `pauseEvery` items.

## Out of scope

- Server-side / cross-device session persistence.
- A session-history record or stats (section 5b / 15 territory).
- Any change to SRS ordering or the learn/next queue.
