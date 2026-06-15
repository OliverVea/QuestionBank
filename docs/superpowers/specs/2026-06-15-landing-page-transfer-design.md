# Landing Page Transfer — Design Spec

**Date:** 2026-06-15
**Status:** Approved (design walkthrough completed; API contract bot-reviewed).
**Mock:** `docs/mocks/index.html` + `docs/mocks/single-screen.css` (Mocks 1+2, decided design — see `docs/mocks/HANDOFF.md`).

## Goal

Transfer the committed landing-page mock onto the real `LandingPage`. The two global
banners (Revisit / Learn) are replaced by:
1. a **global activity header** — day-streak + two weekly goals (cadence + volume), and
2. **per-book cards** — cover + title + mastery progress %, plus per-book revisit/learn pills.

Division of responsibility (consistent with the path-ordering work): the **backend owns
derivation** (per-book aggregates + activity metrics); the **frontend owns presentation**
(layout, relative date rendering, finished-book sinking).

## Resolved decisions

- **Scope:** full mock — activity header AND per-book cards. Goal *targets* are hardcoded
  constants (settings UI deferred). Streak + weekly actuals are computed from attempts.
- **Per-book data:** a **dedicated read-model endpoint** (`GET /api/books/summaries`), not an
  overload of `GET /api/books` (avoids a polymorphic route; plain book list stays single-shape).
- **Activity calc:** **server-side**, returned by `GET /api/activity`.
- **Chapter discovery:** **deferred.** `learnNext.pathPrefix` is the first path segment of the
  next un-attempted problem's label — NOT a discovered chapter. Field named `pathPrefix` (not
  `chapter`) so clients don't build "Chapter X" UI on a free-form value.
- **Progress %:** **mastery-weighted** (not graduated-share), so a worked-but-not-graduated book
  shows real progress.
- **dueNow:** **excludes actively-skipped** problems, matching the revisit queue the pill links to.
- **nextReviewDate:** **ISO date** (not a day-count), consistent with `ProblemSummary.nextReviewDate`
  — the client renders "Ready in N days"; no staleness if cached / page left open past midnight.
- **BookCard:** a **new component**; `BookRow` is left alone and deleted once orphaned.

## API contract

### `GET /api/books/summaries`
Returns the customer's books, each enriched with a derived `summary`. (Plain `GET /api/books`
is unchanged.)

```ts
interface BookSummary {
  progress: number;          // 0–100, mastery-weighted: mean of per-problem weights
                             //   {new:0, improving:0.33, strong:0.66, excellent:1} × 100, rounded.
                             //   0 when the book has no problems (guarded — never NaN).
  dueNow: number;            // count of the book's problems with readiness==='ready' AND not
                             //   actively skipped (matches the revisit queue).
  nextReviewDate: string | null;  // ISO date of the earliest upcoming review among 'waiting'
                             //   problems; null if none scheduled.
  learnNext: { label: string; pathPrefix: string } | null;
                             //   next un-attempted problem in derived path order;
                             //   pathPrefix = label.split('.')[0]. null if nothing left to learn.
}
type BookWithSummary = Book & { summary: BookSummary };
```

All three readiness-derived fields (`progress`, `dueNow`, `nextReviewDate`) come from the SAME
`deriveSummary` pass per problem, so they cannot contradict what `GET /api/books/:id/questions`
reports for the same book.

### `GET /api/activity`
```ts
interface Activity {
  streak: number;            // consecutive calendar days ending today/yesterday with ≥1 attempt.
  daysActive: number;        // distinct active days in the current week window.
  problemsThisWeek: number;  // attempts (count) in the current week window.
  daysGoal: number;          // hardcoded target (e.g. 3) — future settings UI overrides server-side.
  problemsGoal: number;      // hardcoded target (e.g. 20).
}
```
Goal targets ride in the payload so a future settings UI can change them without a client change.

## Backend

### `services/book-summaries.ts` (new, unit-tested)
One bulk load (all questions, attempts, active skip ids), grouped by book. Per book:
- run `deriveSummary` per problem (single pass), then aggregate the four `BookSummary` fields;
- `progress`: mean of mastery weights × 100, rounded; `total === 0 ? 0 : …` guard;
- `dueNow`: count `readiness === 'ready'` AND id ∉ `activeSkippedIds`;
- `nextReviewDate`: min ISO among `waiting` problems' `summary.nextReviewDate`, else null;
- `learnNext`: first un-attempted problem in `compareProblems` order → `{label, pathPrefix}`, else null.

Reuses `deriveSummary`, `activeSkippedIds`, `compareProblems`. No per-book rescans (avoids N+1).

### `services/activity.ts` (new, unit-tested)
`computeActivity(attempts, now)` → streak + weekly actuals. Pure. Streak = consecutive days
ending today (or yesterday, if today not yet active) with ≥1 attempt. Week window = the rolling
last 7 days (today and the 6 prior days) — simpler and timezone-robust vs. a calendar week with a
start-of-week convention; matches "this week" closely enough for a goal tracker. Days are bucketed
by the server's local date (`new Date(now)`); documented so callers know dates are server-local.

### Routes
- `GET /api/books/summaries` in `routes/books.ts` (customer-scoped, like the rest).
- `GET /api/activity` — new small router, mounted at `/api/activity`. Goal-target constants live
  server-side.

## Frontend

### `components/BookCard.{ts,css}` (new)
Ported from the mock's `.book-card` / `.bc-*`. Structure:
- **Head** (`<button>`, tappable → `#/view-book?id=…`): `CoverSlot` + title/author + progress
  (`bc-progress`, with `none`/`complete` modifiers at 0/100%).
- **Action pills** (`bc-actions`), each a `<button>` with `stopPropagation` (so they don't fire the
  head nav) or a quiet `<span>`:
  - revisit `N to revisit` (tappable → `#/revisit`) when `dueNow > 0`;
  - quiet `Ready in N days` when `dueNow === 0 && nextReviewDate != null` (relative, client-computed);
  - learn `Start learning <pathPrefix>` (tappable → `#/learn`) when `learnNext != null`.
- **Finished** books carry no pills (see Edge cases).

### `components/ActivityHeader.{ts,css}` (new)
Three `.stat` metrics (streak, days/wk, problems/wk) with `actual / target` inline and a `.complete`
green state when `actual >= target`. Renders the `Activity` payload.

### `pages/LandingPage.ts` (rewrite)
Single `home-scroll` region: ActivityHeader → library (`<h2>Your library</h2>` + edit button →
`#/manage-books`) → BookCards → add-book button (→ `#/add-book`). Fetches `/api/activity` and
`/api/books/summaries` in parallel; falls back to empty/zero state on error (as today). Removes both
`Banner`s. Preserves the `animate-in` stagger cascade.

### Deletions / shared helpers
- Delete `BookRow.{ts,css}` — only `LandingPage` imports it (confirmed; `ManageBooksPage` uses the
  separate `ManageBookRow`). Remove after the rewrite drops the import.
- `Banner.{ts,css}` — check importers; if `LandingPage` was the only one, flag for deletion too
  (decide during implementation; do not orphan).
- Extract the `daysUntil(iso)` helper (currently inline in `ViewBookPage`) to `lib/` and reuse for
  the card's "Ready in N days".

## Edge cases / sorting

- **Finished** = `progress === 100 && dueNow === 0 && nextReviewDate === null`. Finished cards: no
  pills, green (`.finished`), sunk to the BOTTOM in stable existing order. Completion-date ordering
  is DEFERRED (no stored completion timestamp; `Array.sort` is stable so non-finished keep order).
- **No books** → activity header + add-book only (no library rows).
- **Book with 0 problems** → `progress 0`, `dueNow 0`, no pills, NOT finished (100% guard fails).
- **Cover** reuses `CoverSlot` (client-side OpenLibrary fetch + fallback tile). No change.

## Testing

- **Server units:** `book-summaries.test.ts` (progress weighting; 0-problem guard; dueNow counts
  only `ready` and excludes actively-skipped — note `excellent`/`finalized` is `ready`-excluded by
  construction, so a graduated problem is never counted; nextReviewDate earliest-waiting; learnNext
  path order) and
  `activity.test.ts` (streak with gaps, today-not-yet-active, week window boundaries).
- **UAT:** extend `api-uat.test.ts` — seed a book; assert `/books/summaries` reconciles with
  `/books/:id/questions` for the same book; assert `/activity` shape.
- **Client integration:** rewrite `LandingPage.test.ts` (drop the banner assertions; assert activity
  header metrics + book cards + pills) mirroring the existing fetch-mock style.
- **Manual verify:** seed via `seed-dev.ts`, run the page, confirm activity header + cards render with
  real data and pills navigate correctly.

## Out of scope / deferred

- Settings UI for goal targets (targets hardcoded for now).
- Chapter discovery (`learnNext` uses the next problem's path prefix).
- Completion-date ordering of finished books (sink-to-bottom, stable, for now).
- The GitHub-style calendar / progress rings / streak flame / celebratory variants — explored in the
  mock and explicitly REMOVED; do not re-add (see HANDOFF). No emojis.

## Sequencing (for the plan)

1. Backend: `book-summaries.ts` + `activity.ts` + routes + unit tests + UAT.
2. Frontend: `BookCard`, `ActivityHeader`, `daysUntil` extraction, `LandingPage` rewrite + CSS.
3. Cleanup: delete `BookRow` (+ `Banner` if orphaned); update `LandingPage.test.ts`.

Commit in those chunks (BE read models · landing FE · cleanup).
