# Plan: BE path-ordering + view-book mock transfer

**Date:** 2026-06-14
**Spec:** `docs/superpowers/specs/2026-06-13-derived-problem-ordering-design.md` (decisions resolved 2026-06-14).
**Goal:** Make the backend the source of truth for problem ORDER (derived from the dotted-path
label), and transfer the committed path-fanout mock (`docs/mocks/view-book.*`) onto the real
`ViewBookPage`. Remove client-side drag-to-reorder, now superseded by derived order.

## Division of responsibility (the through-line)

- **Backend owns ORDER.** The questions GET and practice/learn enumeration return problems
  pre-sorted by `(path, createdAt, id)` via one shared comparator. No tree endpoint.
- **Frontend owns GROUPING/PRESENTATION.** Parsing the dotted path into chapter ▸ section groups,
  collapse state, the mastery pill, and the readiness label are all display logic over the
  already-sorted list.

Resolved decisions (from the spec): Option B (server sort); no tree endpoint; numeric-before-alpha
at equal depth; `Book.questionIds[]` stays as storage (membership/reconcile) but is ignored for
display order.

---

## A · Backend: derived path ordering

### A1 — Comparator module (the crux)
New `packages/server/src/services/problem-order.ts`, pure:
- `comparePaths(aLabel, bLabel): number` — `split('.')`, compare segment-by-segment:
  - all-digit segment → numeric compare; otherwise case-insensitive lexicographic;
  - **numeric segments sort before alpha** segments at the same depth;
  - shorter path that is a prefix of a longer one sorts first (`1.A` < `1.A.1`).
- `compareProblems(a, b): number` — `comparePaths(a.label, b.label)`, then `createdAt` ascending,
  then `id`. Total order.
- Unit tests `problem-order.test.ts`: `1.A.2`<`1.A.10`; `2`<`10`; `1.A`<`1.A.1`; equal-path
  tiebreak by createdAt then id; single-segment (`Warm-ups`); numeric-vs-alpha at same depth.
  (`label` is required server-side and defaults to the 1-based index, so `comparePaths` never sees
  `""` in practice — an empty-label case is harmless to include but not load-bearing.)

### A2 — Apply order in the questions GET
`packages/server/src/routes/questions.ts` GET: after enriching with summaries, sort the result by
`compareProblems`. The `reconcileQuestionIds` self-heal still runs (membership), but display order
is now the comparator's, not `questionIds`'.

### A3 — Practice / learn enumeration
The two SRS surfaces differ — confirmed by reading both files — so they get the comparator at
different levels:

- **`learn-next.ts` (`suggestNext`) — path order is PRIMARY.** Today it returns the first
  un-attempted question "within each book, in `questionIds` order." Since order is now derived,
  "the next problem to learn" should follow PATH order: within each book, iterate the book's
  questions sorted by `compareProblems` instead of raw `book.questionIds`. This is the intended
  behavior change (a real improvement — learn now follows the book's structure).
- **`due-queue.ts` (`dueQueue`) — path is only a TIEBREAK.** This is an SRS-urgency surface: it
  already sorts by `nextReviewDate` ascending (most overdue first), which is correct and must NOT
  change. Add `compareProblems` ONLY as the tiebreak when two due items share a `nextReviewDate`
  (currently they compare equal / unstable). Do not make path the primary sort here.

Verify against `srs.test.ts` / any due-queue or learn tests; update expectations only where the
tiebreak/learn-order change is intended.

### A4 — Surface `nextReviewDate` (needed by the mock's "Ready in N days")
- `packages/server/src/domain/types.ts` — add `nextReviewDate?: string` (ISO) to `ProblemSummary`;
  present only when `readiness === 'waiting'`.
- `packages/server/src/services/summary.ts` — refactor `deriveSummary` to call `scheduleFor` ONCE,
  reuse it for both `readiness` and the surfaced date (it currently discards the schedule).
- Confirm `summary.test.ts` / `api-uat.test.ts` don't assert exact object shape (additive optional
  field should be safe).

---

## B · Client: types + view-book presentation

### B1 — Types
`packages/client/src/lib/types.ts` — mirror `nextReviewDate?: string` on `ProblemSummary`.

### B2 — Grouping lib (pure, tested)
New `packages/client/src/lib/problem-grouping.ts` — `splitLabel` + chapter/section bucketing over
the **already-sorted** server list (direct chapter problems before lettered subsections; Ungrouped
last). NO comparator here — order is the server's. Unit test `problem-grouping.test.ts`.

### B3 — MasteryPill component
New `packages/client/src/components/MasteryPill.{ts,css}` — the `.vb-mastery est-*` word pill
(New/Improving/Strong/Excellent), tinted by mastery. The label chip stays a NEUTRAL identifier
(`var(--muted)`) — the green tint lives only on the pill (mock parity).

### B4 — ViewBookPage rewrite (flat → grouped)
`packages/client/src/pages/ViewBookPage.ts`:
- Bucket the fetched list via `problem-grouping`.
- Render two-level collapsible groups (chapter ▸ section): local `makeHeader` / `wireToggle`
  helpers (single-use chrome, not componentized); in-memory collapse, default expanded;
  preserve the global `stagger` counter for the animate-in cascade.
- `makeRow`: label chip + clamped body (`renderLatex`) + `[MasteryPill + CiStrip]` + readiness
  column + chevron. Readiness column:
  - `ready` → "Ready now" (`r-ready`) — this covers OVERDUE too (a past due date is just ready;
    mock parity, no "Overdue by N days" copy);
  - `waiting` → "Ready in N days" where `N = ceil((nextReviewDate − now)/day)` computed at render
    (fall back to "Resting" if `nextReviewDate` absent). `waiting` only ever has a FUTURE date by
    construction (the server marks past-due as `ready`), so N ≥ 1;
  - `finalized` → empty (graduated).
- Row still links to `#/attempts?questionId=…&bookId=…`.

### B5 — ViewBookPage.css
Port group/subgroup/crumb/mastery/ready styles from the committed `docs/mocks/view-book.css`
(scoped under `.view-book-page`): add the `r-finalized` rule and the 4-column row grid
(`label / body / badge+ready / chev`). Keep the direct-child collapse selectors
(`.vb-group.collapsed > .vb-group-rows`, `.vb-subgroup.collapsed > .vb-group-rows`) — a descendant
selector was the original collapse bug.

### B6 — Delete StatusBadge
`StatusBadge.{ts,css}` is imported ONLY by ViewBookPage; the new view drops it. Delete both files
AFTER B4 removes the import (so nothing is orphaned mid-change).

---

## C · Client: remove drag-to-reorder (edit side)

Order is now derived; manual reorder is a competing source of truth. **No client-side comparator is
needed** — EditBookPage already gets derived order from the server (see below), which dissolves the
"share vs duplicate the comparator" question entirely.

In `packages/client/src/components/ProblemsList.ts`:
- Remove `makeDraggable` and both call sites (in `addRow` and `replaceRowById`).
- Remove the DOM-order-sync logic in the drag `onUp` handler. `getProblems()` returns rows in DOM
  order, which is now just insertion order — no longer authoritative for display (the server
  re-derives order on read).
- Keep manual add + per-row edit/delete. A newly-added row appears at the bottom of the working set
  until the next load/refetch re-lands it in path order — acceptable on a small, mobile-first list
  (matches the spec's "appends then re-sorts on next render — simpler"). No live re-sort.
- `ProblemRow.ts` / `ProblemsList.css`: remove the `.pr-handle` drag affordance and the `.pr-spacer`
  / `.dragging` styles.

In `packages/client/src/pages/EditBookPage.ts`:
- **Load path already correct:** `loadBook` fetches `/api/books/:id/questions` (the sorted GET), so
  once A2 lands, rows load in derived path order with zero client work.
- **Scan auto-save resync:** `applyReturnedScanProblems` currently calls `setProblems(saved)` using
  the PUT *response*, which is in `questionIds` (insertion) order — a freshly scanned problem would
  show last. Change it to **re-fetch the sorted GET** after `putProblems()` and `setProblems` from
  that, so scanned problems land in derived position. (Small extra GET; trivial on this list size.)
- Confirm nothing else depends on drag (no renumber-on-reorder coupling beyond what's removed).

**Order on PUT:** `questionIds` stays as storage (membership), so the PUT still carries an order; it
just no longer drives display. `batch-save.ts` needs no change. The PUT round-trips fine with rows in
any order.

---

## D · Out of scope / deferred
- No tree endpoint; `buildTree` untouched (may adopt the comparator later — spec note).
- Chapter "numbers" as a separate editable field (the path already numbers things).
- Section-tree / learn-by-node view.

---

## Sequencing
1. **A1** comparator + tests (foundation).
2. **A2 / A3 / A4** wire ordering + `nextReviewDate`; run server unit + UAT tests.
3. **B1–B5** types, grouping lib + test, MasteryPill, page rewrite, CSS; typecheck/build.
4. **B6** delete StatusBadge (after import removed).
5. **C** remove drag-reorder; verify edit-book add/edit/scan-merge still persist.

Commit in those chunks (BE ordering · view-book presentation · drag removal).

## Verification (evidence before "done")
- Server: `problem-order.test.ts` green; `summary.test.ts` + `api-uat.test.ts` green with the new
  field; `learn-next` follows path order, `due-queue` order unchanged except the new tiebreak.
- Client: `problem-grouping.test.ts` green; build/typecheck clean.

**Seeding for the render check** ("Ready in N days" only shows for `waiting` problems — i.e. has
attempts, not excellent, due in the future). Easiest path: extend the API-UAT/fixture or POST via the
API — create a book, POST questions with out-of-order dotted labels (`2.3`, `1.A.10`, `1.A.2`,
`1.B.1`, an unlabelled one), and seed varied attempts so the set spans all readiness states:
- no attempts → `ready` ("Ready now");
- recent correct streak (≥3) → `excellent`/`finalized` (empty readiness column);
- one or two attempts, last review recent → `waiting` with a future `nextReviewDate` ("Ready in N
  days");
- attempt with a due date already past → `ready`.
Then GET the list and confirm it returns path-ordered with `nextReviewDate` on the waiting ones.

- Render the real ViewBookPage against that book: path-ordered two-level grouping, both collapse
  levels independent, mastery pill tint per state, "Ready in N days" matches the seeded due dates,
  rows link to attempts.
- EditBookPage: load shows rows in derived path order; add a problem with an out-of-order path →
  after save/reload it lands in sorted position; no drag handle present; scan-merge still persists
  and lands scanned rows in derived order (via the post-PUT refetch).
