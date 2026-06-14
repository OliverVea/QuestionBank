# Derived Problem Ordering — Design Spec

**Status:** Decisions resolved 2026-06-14 (see "Resolved decisions" below). Ready for a plan.
Supersedes the earlier "chapter numbers + drag-and-drop reorder" request.

## Resolved decisions (2026-06-14)

1. **Sort location: Option B (server-side).** The questions GET returns problems pre-sorted by the
   comparator; practice/learn enumeration applies the same comparator. Single source of truth.
2. **No tree endpoint.** The API does NOT return a `buildTree` projection — that gets complicated
   fast. The BE owns **ordering only**; the FE keeps owning **grouping/presentation** (parsing the
   dotted path into chapter ▸ section is display logic, done client-side over the pre-sorted list).
   `buildTree` stays as-is for the extraction pipeline; it may later share the comparator (deferred).
3. **Numeric-before-alpha** at the same depth (all-digit segments sort ahead of named segments).
4. **`Book.questionIds[]` stays as storage**, ignored for display order. Membership + reconcile
   self-heal still use it; the comparator decides order on read. (So `batch-save.ts` need not change
   its order derivation now — `questionIds` simply stops being the *display* authority.)

**Goal:** Stop storing/honoring an explicit problem order. Always present a book's problems
ordered by **(path, createdAt, id)** with a natural/numeric-aware comparator. Remove
drag-to-reorder from the client.

---

## Motivation

- Multi-page extraction now gives every problem a **dotted-path label** (`1.A.3`) that already
  encodes the book's structure. Deriving display order from that path keeps the list consistent
  with the derived section tree (`buildTree`) and the flat-problems API model, with no separate
  stored ordering to maintain or migrate as problems are added/edited.
- Manual drag-reorder is awkward on the primary target (mobile) and competes with path order —
  two sources of truth for "what comes first." Deriving order removes the conflict.

## The ordering key

Sort by, in priority:
1. **path** — compared **segment-by-segment** after `split('.')`, with **numeric-aware** comparison
   so `1.A.2` precedes `1.A.10` and chapter `2` precedes `10`. A segment that is all-digits sorts
   numerically; otherwise lexicographically (case-insensitive). Shorter paths that are a prefix of
   a longer one sort first (`1.A` before `1.A.1`). Mixed alpha/numeric segments (`A` vs `1`):
   decide a stable rule — proposed: numeric segments before alpha segments at the same depth.
2. **createdAt** — ISO-8601 timestamp, ascending (oldest first). Breaks ties when two problems
   share a full path (allowed — a path may hold several problems).
3. **id** — final tiebreaker for total determinism when createdAt is equal.

This comparator is the crux of the work. It should be a single pure function
(`compareProblems(a, b)` / `comparePaths(aPath, bPath)`) with direct unit tests covering:
`1.A.2` vs `1.A.10`; `2` vs `10`; `1.A` vs `1.A.1`; equal-path tiebreak by createdAt then id;
single-segment labels (`Warm-ups`); numeric-vs-alpha segment ordering.

## Where the sort lives — DECISION NEEDED

- **Option A — client/display only:** sort in `EditBookPage` / `ProblemsList` (and any other view)
  before rendering. Smallest change; server storage and API unchanged. Risk: each consumer
  (practice, learn, tree) must apply the same comparator or they disagree.
- **Option B — server-side:** the questions GET (and practice/learn ordering) return problems
  pre-sorted by the comparator, so all consumers agree by construction. Bigger change; touches the
  API and every consumer, but single source of truth.

Recommendation: **B** if practice/learn order matters to the user; **A** if only the edit-book view
needs it for now (and revisit when the section-tree view lands). Pick before implementing.

## Client changes (both options)

- `ProblemsList`: **remove drag-to-reorder** — `makeDraggable`, the `.pr-handle` drag wiring, the
  reorder-on-drop logic, and the renumber-on-reorder coupling. Rows render in comparator order;
  `getProblems()` returns them in that order. Adding a problem inserts it at its sorted position
  (or appends then re-sorts on next render — simpler).
- Re-sort triggers: after add, after a label/path edit (since the path is the sort key), and after
  the scan handoff merge.
- Keep manual add + per-row edit/delete. Only **reordering** is removed.

## Server changes (Option B only)

- Decide the fate of `Book.questionIds[]` (the current explicit order). Either keep it as storage
  but ignore it for display (sort on read), or drop it from the ordering contract entirely.
  `planBatchSave` currently derives `questionIds` from incoming order — if order is derived, the
  PUT no longer needs to carry it; revisit `batch-save.ts`.
- Apply `compareProblems` in the questions GET and wherever practice/learn enumerate a book's
  problems.

## buildTree alignment

`buildTree` currently preserves **first-seen** order at each level. If the section tree should
reflect the same derived order, give `buildTree` the same segment comparator (sort children +
co-path leaves by the key). Out of scope for the view itself (still deferred), but the comparator
should be shared so they can't drift.

## Out of scope

- The section-tree VIEW / learn-by-node UI (still deferred from the multi-page extraction plan).
- Chapter "numbers" as a separate user-editable label (the path already numbers things).

## Open questions to resolve before writing a plan

1. Sort location: A (client) or B (server)? (Drives the whole plan's size.)
2. Numeric-vs-alpha segment rule at the same depth — confirm "numeric before alpha."
3. Does `Book.questionIds[]` stay (storage only) or go?
4. Should `buildTree` adopt the comparator now, or stay first-seen until the tree view is built?
