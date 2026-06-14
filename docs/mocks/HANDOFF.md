# Handoff — landing-page mocks for "path as the organizing concept"

Context for whoever picks up the mock work next. This is a **mock task** —
static HTML/CSS/JS prototypes in `docs/mocks/`, built to design before the real
client. Follow `docs/mocks/AGENTS.md` (skeleton-first, reuse `mocks.css` tokens,
phone-first with `:active` feedback, hover gated behind `@media (hover: hover)`,
inline disposable JS). Serve with `npm run mocks` (http://localhost:4173).

## The design these mocks express (DECIDED — don't reopen)

**The dotted path label (`1.A.3`) IS the organizing concept** — it drives
ordering, "where am I," and naming. No stored order, no drag-reorder
(superseded), no stored cursor.

- Path segments map positionally to Chapter / Section / Subsection / Part; a
  final numeric segment reads "Problem N". `2.C.3` = "Chapter 2, Section C,
  Problem 3"; `3.3` = "Chapter 3, Problem 3". Duplicate full paths allowed
  (several problems share `1.A`); they get implicit indices by createdAt.
- Three surfaces, three orderings (backend, out of scope for mocks — listed so
  demo data/labels stay coherent):

| Surface | Population | Ordering | Scope |
|---|---|---|---|
| Edit/browse | all problems | `(path, createdAt, id)` | whole book, flat list |
| Learn | un-attempted ("solved" = any attempt) | `(relevance, path, createdAt, id)` | the discovered chapter |
| Revisit | attempted & due (SRS) | `(relevance, overdue, path)` — relevance FIRST | per book; path-independent |

- **relevance** is already on each Question (`'high'|'medium'|'low'`, LLM-set +
  human-reviewed; `packages/server/src/domain/types.ts`). Ordered by, not computed.
- **Chapter discovery** (server-side, will live in `learn-next.ts`): earliest
  top path-segment with any unsolved work, then within it the deepest node whose
  subtree holds >3 problems with ≥1 unsolved. Fallback: whole chapter, then
  whole book.
- "solved" for Learn = any attempt (wrong answers resurface via Revisit/SRS).

## What was built this session (landing page — `docs/mocks/index.html`)

Mocks 1 + 2 of the brief, both on `index.html`. The two old global banners
(`#revisit-banner`, `#learn-banner`) are GONE; their info is folded per-book.

### Stats header (global, top of page)
A single full-width card (`.activity`) spanning all books — the one cross-book
surface; everything else is per-book. **Three metrics in a row, split by
dividers:**
- **Day streak** — consecutive days with ≥1 attempt (`computeStreak`).
- **Days / week goal** — cadence; `actual / target` inline, turns green when met.
- **Problems / week goal** — volume; same inline `actual / target` treatment.

Goal values AND windows are user-defined → **hardcoded placeholders** in the
`activity` demo object with `// TODO: user-defined` notes (no settings UI in the
mock). Streak/goal anchor to the real `new Date()` (allowed — the
no-nondeterminism rule was only ever scoped to the dropped celebratory variant).

### Per-book cards (`.book-card`)
Each card, built in the `data.books.forEach` loop:
- **Head** (`.bc-head`, a `<button>`): cover + title + `progress%`. Opens
  `view-book.html?isbn=…`. Progress is mastery %; the old corner "N ready" count
  was dropped (the revisit pill carries readiness now).
- **Action pills** (`.bc-actions`): compact chips folded in from the old banners.
  - Revisit pill `N to revisit` (purple, tappable → `learn.html`) when due now.
  - Quiet `Ready in N days` chip when attempted but nothing due (relative, from
    `nextReviewInDays`). Absent when nothing attempted.
  - Learn pill `Start learning <chapter>` (green, tappable → `learn.html`) when a
    chapter was discovered; omitted when nothing left to learn.
  - Tappable pills are `<button>`s with `stopPropagation` so they don't fire the
    head's view-book nav. (Important: the card is NOT an `<a>` wrapping buttons.)
- **Finished books** (`isFinished`: 100% AND nothing due/scheduled): no pills,
  whole row reads green (`.book-card.finished`), sorted to the BOTTOM ordered by
  completion date (`completedDaysAgo`, oldest-completed first). `data.books` is
  sorted up front; `Array.sort` is stable so unfinished books keep their order.

### Layout / shell
`.app` is now a single scrolling region (`.home-scroll`) — the stats header and
the library scroll together (header + taller cards don't fit one phone screen).
Was a fixed `auto auto 1fr` one-screen shell.

## Things explored this session and then REMOVED (don't re-add without asking)
The header went through several iterations before landing on the 3-number row:
- GitHub-style contribution calendar grid → removed.
- Single-row scrollable day-history strip → removed.
- Progress rings (SVG arc + `foreignObject` center) for the metrics → removed.
- A flame icon for the streak (intensity by length) → removed ("out of place").
- Celebratory "you know this by heart" line for mastered books (hashed-by-isbn
  variants) → removed; replaced by the plain green finished row.
- Diagonal gradient card surface → removed.
- **No emojis** anywhere (explicit preference).

If a calendar/history/ring comes back, the git history of `index.html` has the
working implementations to crib from.

## NOT done yet — Mock 3 (path fan-out) is still TODO
`view-book.html` was **not touched** this session. The remaining brief item:
make each dotted-path segment a **non-intrusive** affordance in the problem
browse list — e.g. `1 › A › 3` where levels feel distinct/collapsible WITHOUT
turning the dense mobile list into a heavy tree ("fan out on each path element in
a non-intrusive way"). Browse-only nicety, NOT learn-by-node navigation
(deferred). Read `view-book.html` + `view-book.css` first (flat problem list with
status badges + CI-history strips). Expect to iterate — land a skeleton, then try
the fan-out treatment. Do NOT build a heavy tree/navigation UI.

## Files
- `docs/mocks/index.html` — landing page (Mocks 1+2). Demo data in the `activity`
  + `data` objects near the top of the inline `<script>`.
- `docs/mocks/single-screen.css` — home shell, `.activity` header card,
  `.book-card` / `.bc-*` styles.
- `docs/mocks/mocks.css` — shared tokens; added `--streak` / `--streak-dark`.
- `docs/mocks/view-book.html` + `view-book.css` — Mock 3 target (untouched).
- `docs/mocks/AGENTS.md` — the mock rules (read first).

## Gotchas
- A concurrent agent does "pipeline / integration-test-gates" work here (touches
  `package.json` / `vitest.config.ts` / `package-lock.json` + a CD pipeline and
  `docs/superpowers/plans/2026-06-13-pipeline-integration-test-gates.md`). **Stay
  out of its lane** — stage only files you author, by exact path. NEVER `git add -A`.
- `.claude/settings.local.json` is perpetually modified — never commit it.
- `npm run mocks` may already be running (mocks :4173, client :5174, server :3001).
- Do NOT touch real client/server code — this is a mock task. A spec comes after
  the mocks are approved.
