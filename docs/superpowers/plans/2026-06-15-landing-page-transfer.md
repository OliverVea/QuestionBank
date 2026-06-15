# Landing Page Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the landing page's two global banners with a global activity header (streak + two weekly goals) and per-book cards (mastery-weighted progress %, revisit/learn pills), fed by two new server read-model endpoints.

**Architecture:** Backend owns derivation — two new services (`book-summaries`, `activity`) + two routes (`GET /api/books/summaries`, `GET /api/activity`) computed from a single bulk load, reusing `deriveSummary`/`compareProblems`/`activeSkippedIds`. Frontend owns presentation — new `BookCard` + `ActivityHeader` components and a rewritten `LandingPage`; `BookRow` and `Banner` are deleted (orphaned).

**Tech Stack:** TypeScript, Express 5, Vitest (server: node env; client: jsdom), framework-free DOM via the `html` helper. Tests colocated in `packages/server/src/**` and `packages/client/tests/**`.

**Spec:** `docs/superpowers/specs/2026-06-15-landing-page-transfer-design.md`

---

## File Structure

**Backend (commit 1):**
- Create `packages/server/src/services/book-summaries.ts` — per-book aggregate derivation.
- Create `packages/server/src/services/book-summaries.test.ts` — its units.
- Create `packages/server/src/services/activity.ts` — streak + weekly actuals.
- Create `packages/server/src/services/activity.test.ts` — its units.
- Create `packages/server/src/routes/activity.ts` — `GET /api/activity`.
- Modify `packages/server/src/routes/books.ts` — add `GET /api/books/summaries` (BEFORE `/:id`).
- Modify `packages/server/src/index.ts` — mount the activity router.
- Modify `packages/server/src/domain/types.ts` — add `BookSummary`, `BookWithSummary`, `Activity`.
- Modify `packages/server/src/uat/api-uat.test.ts` — UAT for both endpoints.

**Frontend (commit 2):**
- Create `packages/client/src/lib/dates.ts` — `daysUntil(iso)` (extracted, reused).
- Create `packages/client/src/components/ActivityHeader.ts` + `.css`.
- Create `packages/client/src/components/BookCard.ts` + `.css`.
- Modify `packages/client/src/lib/types.ts` — mirror `BookSummary`/`BookWithSummary`/`Activity`.
- Modify `packages/client/src/styles/tokens.css` — add `--streak`/`--streak-dark`.
- Modify `packages/client/src/pages/LandingPage.ts` + `.css` — rewrite.
- Modify `packages/client/src/pages/ViewBookPage.ts` — use the extracted `daysUntil`.

**Cleanup (commit 3):**
- Delete `packages/client/src/components/BookRow.ts` + `.css`.
- Delete `packages/client/src/components/Banner.ts` + `.css`.
- Modify `packages/client/tests/integration/LandingPage.test.ts` — rewrite for the new UI.

---

## Task 1: Domain types for the read models

**Files:**
- Modify: `packages/server/src/domain/types.ts` (append at end)

- [ ] **Step 1: Add the types**

Append to `packages/server/src/domain/types.ts`:

```ts
/** Per-book derived aggregate for the landing read model (never persisted). */
export interface BookSummary {
  /** 0–100, mastery-weighted mean across the book's problems (0 when no problems). */
  progress: number;
  /** Count of the book's problems that are 'ready' and NOT actively skipped. */
  dueNow: number;
  /** ISO date of the earliest upcoming review among 'waiting' problems; null if none. */
  nextReviewDate: string | null;
  /** Next un-attempted problem (derived path order); null if nothing left to learn. */
  learnNext: { label: string; pathPrefix: string } | null;
}

/** A book plus its landing summary, as returned by GET /api/books/summaries. */
export type BookWithSummary = Book & { summary: BookSummary };

/** Global activity metrics for the landing header (never persisted). */
export interface Activity {
  /** Consecutive calendar days ending today/yesterday with ≥1 attempt. */
  streak: number;
  /** Distinct active days within the rolling last-7-day window. */
  daysActive: number;
  /** Attempt count within the rolling last-7-day window. */
  problemsThisWeek: number;
  /** Hardcoded cadence target (days/week). */
  daysGoal: number;
  /** Hardcoded volume target (problems/week). */
  problemsGoal: number;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p packages/server/tsconfig.json --noEmit`
Expected: exit 0 (no output).

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/domain/types.ts
git commit -m "feat(server): landing read-model types (BookSummary, Activity)"
```

---

## Task 2: `book-summaries` service

**Files:**
- Create: `packages/server/src/services/book-summaries.ts`
- Test: `packages/server/src/services/book-summaries.test.ts`

Mastery weights: `{ new: 0, improving: 0.33, strong: 0.66, excellent: 1 }`. The service takes
already-loaded data (so the route does one bulk load) and is pure.

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/services/book-summaries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Attempt, Book, Grade, Question } from '../domain/types.js';
import { summarizeBooks } from './book-summaries.js';

const NOW = '2026-06-15T00:00:00.000Z';
const daysAgoIso = (n: number): string => new Date(new Date(NOW).getTime() - n * 86_400_000).toISOString();

const book = (id: string, questionIds: string[]): Book => ({
  id, customerId: 'c', title: id, questionIds, createdAt: daysAgoIso(40),
});
const q = (id: string, bookId: string, label: string): Question => ({
  id, customerId: 'c', bookId, label, canonicalText: label, source: { kind: 'text' }, createdAt: daysAgoIso(40),
});
const attempt = (questionId: string, rating: Grade, daysAgo: number): Attempt => ({
  id: `a-${questionId}-${daysAgo}`, customerId: 'c', questionId,
  answer: 'x', recommendedGrade: rating, rating, issues: [], createdAt: daysAgoIso(daysAgo),
});

describe('summarizeBooks', () => {
  it('progress is the mastery-weighted mean × 100, rounded; 0 for an empty book', () => {
    const b = book('b', ['q1', 'q2']);
    const qs = [q('q1', 'b', '1'), q('q2', 'b', '2')];
    // q1: no attempts → 'new' (0). q2: one correct 1 day ago → 'improving' (0.33).
    const attempts = [attempt('q2', 'correct', 1)];
    const [s] = summarizeBooks([b], qs, attempts, new Set(), NOW);
    expect(s!.summary.progress).toBe(17); // round((0 + 0.33)/2 * 100) = 17

    const [empty] = summarizeBooks([book('e', [])], [], [], new Set(), NOW);
    expect(empty!.summary.progress).toBe(0); // guarded, never NaN
  });

  it('dueNow counts ready problems and excludes actively-skipped ones', () => {
    const b = book('b', ['q1', 'q2']);
    const qs = [q('q1', 'b', '1'), q('q2', 'b', '2')];
    // Both due: one correct 10 days ago → step 1 → due 3 days ago → ready.
    const attempts = [attempt('q1', 'correct', 10), attempt('q2', 'correct', 10)];
    const open = summarizeBooks([b], qs, attempts, new Set(), NOW);
    expect(open[0]!.summary.dueNow).toBe(2);
    const skipped = summarizeBooks([b], qs, attempts, new Set(['q2']), NOW);
    expect(skipped[0]!.summary.dueNow).toBe(1);
  });

  it('nextReviewDate is the earliest among waiting problems; null when none waiting', () => {
    const b = book('b', ['q1', 'q2']);
    const qs = [q('q1', 'b', '1'), q('q2', 'b', '2')];
    // partial 1 day ago → step 0 → due in 6 days (waiting). Two of them: earliest wins (same here).
    const attempts = [attempt('q1', 'partial', 1), attempt('q2', 'partial', 3)];
    const [s] = summarizeBooks([b], qs, attempts, new Set(), NOW);
    expect(s!.summary.nextReviewDate).not.toBeNull();
    // q1 reviewed 1 day ago → due NOW+6d; q2 reviewed 3 days ago → due NOW+4d (earlier).
    expect(s!.summary.nextReviewDate).toBe(new Date(new Date(NOW).getTime() + 4 * 86_400_000).toISOString());

    const none = summarizeBooks([book('n', ['q3']), ], [q('q3', 'n', '1')], [], new Set(), NOW);
    expect(none[0]!.summary.nextReviewDate).toBeNull();
  });

  it('learnNext is the first un-attempted problem in derived path order, with its path prefix', () => {
    const b = book('b', ['q1', 'q2', 'q3']);
    // Out of path order in storage; q2 (1.A.2) is attempted, so learnNext skips it.
    const qs = [q('q1', 'b', '2.1'), q('q2', 'b', '1.A.2'), q('q3', 'b', '1.A.10')];
    const attempts = [attempt('q2', 'correct', 1)];
    const [s] = summarizeBooks([b], qs, attempts, new Set(), NOW);
    // Path order: 1.A.2 (attempted, skip) → 1.A.10 → 2.1. First un-attempted = 1.A.10.
    expect(s!.summary.learnNext).toEqual({ label: '1.A.10', pathPrefix: '1' });
  });

  it('learnNext is null when every problem has an attempt', () => {
    const b = book('b', ['q1']);
    const qs = [q('q1', 'b', '1')];
    const [s] = summarizeBooks([b], qs, [attempt('q1', 'correct', 1)], new Set(), NOW);
    expect(s!.summary.learnNext).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project server packages/server/src/services/book-summaries.test.ts`
Expected: FAIL — `summarizeBooks` not found / cannot import.

- [ ] **Step 3: Write the implementation**

Create `packages/server/src/services/book-summaries.ts`:

```ts
import type { Attempt, BookWithSummary, Book, Mastery, Question } from '../domain/types.js';
import { compareProblems } from './problem-order.js';
import { deriveSummary } from './summary.js';

/** Mastery → progress weight; the per-book progress % is the mean × 100. */
const MASTERY_WEIGHT: Record<Mastery, number> = { new: 0, improving: 0.33, strong: 0.66, excellent: 1 };

/**
 * Derive each book's landing summary from already-loaded data (one bulk load by the
 * caller; no per-book rescans). All readiness-derived fields come from the SAME
 * deriveSummary pass per problem, so they cannot disagree with the book-detail view.
 * `now` is an ISO timestamp; `skippedIds` are the currently-active skip question ids.
 */
export function summarizeBooks(
  books: Book[],
  questions: Question[],
  attempts: Attempt[],
  skippedIds: Set<string>,
  now: string,
): BookWithSummary[] {
  const questionsByBook = new Map<string, Question[]>();
  for (const q of questions) {
    const list = questionsByBook.get(q.bookId);
    if (list) list.push(q);
    else questionsByBook.set(q.bookId, [q]);
  }
  const attemptsByQuestion = new Map<string, Attempt[]>();
  for (const a of attempts) {
    const list = attemptsByQuestion.get(a.questionId);
    if (list) list.push(a);
    else attemptsByQuestion.set(a.questionId, [a]);
  }

  return books.map((book) => {
    const bookQuestions = (questionsByBook.get(book.id) ?? []).slice().sort(compareProblems);

    let weightSum = 0;
    let dueNow = 0;
    let earliestNext: string | null = null;
    let learnNext: { label: string; pathPrefix: string } | null = null;

    for (const q of bookQuestions) {
      const qAttempts = attemptsByQuestion.get(q.id) ?? [];
      const summary = deriveSummary(qAttempts, now);
      weightSum += MASTERY_WEIGHT[summary.mastery];

      if (summary.readiness === 'ready' && !skippedIds.has(q.id)) dueNow += 1;
      if (summary.nextReviewDate && (earliestNext === null || summary.nextReviewDate < earliestNext)) {
        earliestNext = summary.nextReviewDate;
      }
      // First un-attempted problem in path order → learnNext.
      if (learnNext === null && qAttempts.length === 0) {
        learnNext = { label: q.label, pathPrefix: q.label.split('.')[0] ?? q.label };
      }
    }

    const total = bookQuestions.length;
    const progress = total === 0 ? 0 : Math.round((weightSum / total) * 100);

    return { ...book, summary: { progress, dueNow, nextReviewDate: earliestNext, learnNext } };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project server packages/server/src/services/book-summaries.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/book-summaries.ts packages/server/src/services/book-summaries.test.ts
git commit -m "feat(server): book-summaries service (per-book landing aggregate)"
```

---

## Task 3: `activity` service

**Files:**
- Create: `packages/server/src/services/activity.ts`
- Test: `packages/server/src/services/activity.test.ts`

Window = rolling last 7 days, bucketed by server-local date. Goal targets are constants here.

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/services/activity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Attempt, Grade } from '../domain/types.js';
import { computeActivity, DAYS_GOAL, PROBLEMS_GOAL } from './activity.js';

const NOW = '2026-06-15T12:00:00.000Z';
const daysAgoIso = (n: number): string => new Date(new Date(NOW).getTime() - n * 86_400_000).toISOString();
const at = (daysAgo: number): Attempt => ({
  id: `a-${daysAgo}-${Math.floor(daysAgo * 1000)}`, customerId: 'c', questionId: 'q',
  answer: 'x', recommendedGrade: 'correct' as Grade, rating: 'correct' as Grade, issues: [], createdAt: daysAgoIso(daysAgo),
});

describe('computeActivity', () => {
  it('streak counts consecutive days ending today', () => {
    const a = [at(0), at(1), at(2), /* gap at 3 */ at(4)];
    expect(computeActivity(a, NOW).streak).toBe(3);
  });

  it('streak tolerates today not yet active (counts from yesterday)', () => {
    const a = [at(1), at(2)]; // nothing today
    expect(computeActivity(a, NOW).streak).toBe(2);
  });

  it('zero attempts → zero streak and zero week actuals', () => {
    const z = computeActivity([], NOW);
    expect(z.streak).toBe(0);
    expect(z.daysActive).toBe(0);
    expect(z.problemsThisWeek).toBe(0);
  });

  it('week window is the rolling last 7 days (day 0..6 in, day 7 out)', () => {
    const a = [at(0), at(0), at(3), at(6), at(7) /* outside */];
    const r = computeActivity(a, NOW);
    expect(r.problemsThisWeek).toBe(4); // 2 today + 1 + 1, the day-7 one excluded
    expect(r.daysActive).toBe(3);       // days 0, 3, 6
  });

  it('returns the hardcoded goal targets', () => {
    const r = computeActivity([], NOW);
    expect(r.daysGoal).toBe(DAYS_GOAL);
    expect(r.problemsGoal).toBe(PROBLEMS_GOAL);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project server packages/server/src/services/activity.test.ts`
Expected: FAIL — `computeActivity` not found.

- [ ] **Step 3: Write the implementation**

Create `packages/server/src/services/activity.ts`:

```ts
import type { Activity, Attempt } from '../domain/types.js';

/** Hardcoded weekly goal targets (a future settings UI will override these). */
export const DAYS_GOAL = 3;
export const PROBLEMS_GOAL = 20;

/** Rolling window length, in days (today + 6 prior). */
const WEEK_DAYS = 7;

/** Server-local date key (YYYY-MM-DD) for an ISO timestamp. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Whole days between two timestamps, by server-local date (ignores time-of-day). */
function dayDelta(now: string, then: string): number {
  const n = new Date(now);
  const t = new Date(then);
  const nMid = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  const tMid = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  return Math.round((nMid - tMid) / 86_400_000);
}

/**
 * Streak + rolling-week actuals from attempts. Streak = consecutive calendar days
 * ending today (or yesterday, if today not yet active) with ≥1 attempt. Week window =
 * the last WEEK_DAYS days, bucketed by server-local date. Pure.
 */
export function computeActivity(attempts: Attempt[], now: string): Activity {
  const activeDays = new Set<number>();
  let problemsThisWeek = 0;
  const weekDays = new Set<string>();

  for (const a of attempts) {
    const delta = dayDelta(now, a.createdAt);
    if (delta >= 0) activeDays.add(delta);
    if (delta >= 0 && delta < WEEK_DAYS) {
      problemsThisWeek += 1;
      weekDays.add(dayKey(a.createdAt));
    }
  }

  // Streak: walk back from today; allow today (delta 0) to be missing.
  let streak = 0;
  for (let d = 0; d < 400; d++) {
    if (activeDays.has(d)) streak += 1;
    else if (d === 0) continue; // today not yet active is OK
    else break;
  }

  return {
    streak,
    daysActive: weekDays.size,
    problemsThisWeek,
    daysGoal: DAYS_GOAL,
    problemsGoal: PROBLEMS_GOAL,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project server packages/server/src/services/activity.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/activity.ts packages/server/src/services/activity.test.ts
git commit -m "feat(server): activity service (streak + rolling-week actuals)"
```

---

## Task 4: `GET /api/books/summaries` route

**Files:**
- Modify: `packages/server/src/routes/books.ts`

The new route MUST be declared BEFORE `router.get('/:id', …)` so `/summaries` isn't captured as an `:id`.

- [ ] **Step 1: Add imports**

At the top of `packages/server/src/routes/books.ts`, add to the existing imports:

```ts
import { nowIso } from '../domain/ids.js';
import { summarizeBooks } from '../services/book-summaries.js';
import { activeSkippedIds } from './skip.js';
```

(Note: `newId, nowIso` may already be imported from `../domain/ids.js` — merge, don't duplicate.)

- [ ] **Step 2: Add the route handler**

In `booksRouter`, immediately AFTER `router.put('/order', …)` and BEFORE `router.get('/:id', …)`, insert:

```ts
  router.get('/summaries', async (req, res) => {
    const customerId = requireCustomerId(req);
    const [books, questions, attempts, skipped] = await Promise.all([
      store.books.getAll(customerId),
      store.questions.getAll(customerId),
      store.attempts.getAll(customerId),
      activeSkippedIds(store, customerId),
    ]);
    res.json(summarizeBooks(books, questions, attempts, skipped, nowIso()));
  });
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p packages/server/tsconfig.json --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/books.ts
git commit -m "feat(server): GET /api/books/summaries read model"
```

---

## Task 5: `GET /api/activity` route

**Files:**
- Create: `packages/server/src/routes/activity.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Create the router**

Create `packages/server/src/routes/activity.ts`:

```ts
import { Router } from 'express';
import { nowIso } from '../domain/ids.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import { computeActivity } from '../services/activity.js';
import type { Store } from '../storage/store.js';

/** /api/activity — global streak + weekly-goal metrics for the landing header. */
export function activityRouter(store: Store): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    const attempts = await store.attempts.getAll(requireCustomerId(req));
    res.json(computeActivity(attempts, nowIso()));
  });
  return router;
}
```

- [ ] **Step 2: Mount it in index.ts**

In `packages/server/src/index.ts`, add the import alongside the other route imports:

```ts
import { activityRouter } from './routes/activity.js';
```

And mount it next to the other `app.use('/api/...')` lines (e.g. after the practice router):

```ts
  app.use('/api/activity', activityRouter(store));
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p packages/server/tsconfig.json --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/activity.ts packages/server/src/index.ts
git commit -m "feat(server): GET /api/activity route"
```

---

## Task 6: UAT for both endpoints

**Files:**
- Modify: `packages/server/src/uat/api-uat.test.ts`

Add one `it(...)` exercising both endpoints over the real `createApp` (via supertest, the file's
existing pattern). Use the existing `createBook`/`saveProblems` helpers (defined near the top of the file).

- [ ] **Step 1: Add the test**

Insert this `it(...)` inside the top-level `describe(...)` block, after the "Ordering:" test added earlier:

```ts
  it('Landing: /books/summaries reconciles with /books/:id/questions; /activity returns shape', async () => {
    const book = await createBook();
    const [first, second] = await saveProblems(book.id, [
      { label: '1.A.1', canonicalText: 'first' },
      { label: '1.A.2', canonicalText: 'second' },
    ]);
    // Attempt the first → it's no longer the learn suggestion; book is partially progressed.
    await request(app)
      .post(`/api/questions/${first.id}/attempts`)
      .send({ answer: 'a', recommendedGrade: 'correct', rating: 'correct', issues: [] });

    const summaries = (await request(app).get('/api/books/summaries')).body;
    const mine = summaries.find((b: { id: string }) => b.id === book.id);
    expect(mine.summary.progress).toBeGreaterThan(0);                 // one improving problem
    expect(mine.summary.learnNext).toEqual({ label: '1.A.2', pathPrefix: '1' }); // second is next
    expect(mine.summary.dueNow).toBe(0);                              // freshly attempted → not due
    void second;

    const activity = (await request(app).get('/api/activity')).body;
    expect(activity).toMatchObject({ daysGoal: 3, problemsGoal: 20 });
    expect(activity.streak).toBeGreaterThanOrEqual(1);                // attempted today
    expect(activity.problemsThisWeek).toBeGreaterThanOrEqual(1);
  });
```

- [ ] **Step 2: Run the UAT + the whole server suite**

Run: `npx vitest run --project server`
Expected: PASS (all server tests green, including the new UAT).

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/uat/api-uat.test.ts
git commit -m "test(server): UAT for /books/summaries + /activity"
```

---

## Task 7: Client types + `daysUntil` extraction

**Files:**
- Modify: `packages/client/src/lib/types.ts` (append)
- Create: `packages/client/src/lib/dates.ts`
- Modify: `packages/client/src/pages/ViewBookPage.ts`

- [ ] **Step 1: Add client types**

Append to `packages/client/src/lib/types.ts`:

```ts
/** Per-book landing summary, from GET /api/books/summaries. Mirrors the server. */
export interface BookSummary {
  progress: number;
  dueNow: number;
  nextReviewDate: string | null;
  learnNext: { label: string; pathPrefix: string } | null;
}

export type BookWithSummary = Book & { summary: BookSummary };

/** Global activity metrics, from GET /api/activity. Mirrors the server. */
export interface Activity {
  streak: number;
  daysActive: number;
  problemsThisWeek: number;
  daysGoal: number;
  problemsGoal: number;
}
```

- [ ] **Step 2: Create the dates helper**

Create `packages/client/src/lib/dates.ts`:

```ts
/** Whole days from now until `iso` (≥ 1 by construction for a future review), as "N days". */
export function daysUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.max(1, Math.ceil(ms / 86_400_000));
  return `${days} day${days === 1 ? '' : 's'}`;
}
```

- [ ] **Step 3: Use it in ViewBookPage**

In `packages/client/src/pages/ViewBookPage.ts`, add to the imports:

```ts
import { daysUntil } from '@/lib/dates';
```

Then DELETE the local `daysUntil` function (the one at the bottom of the file) so the import is used.
The call site `Ready in ${daysUntil(nextReviewDate)}` stays unchanged.

- [ ] **Step 4: Build the client**

Run: `npm --prefix packages/client run build`
Expected: exit 0 (tsc -b + vite build succeed; no unused/dup `daysUntil`).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/lib/types.ts packages/client/src/lib/dates.ts packages/client/src/pages/ViewBookPage.ts
git commit -m "refactor(client): landing types + extract daysUntil to lib/dates"
```

---

## Task 8: `ActivityHeader` component

**Files:**
- Create: `packages/client/src/components/ActivityHeader.ts`
- Create: `packages/client/src/components/ActivityHeader.css`
- Modify: `packages/client/src/styles/tokens.css`

- [ ] **Step 1: Add the streak tokens**

The mock used `--streak`/`--streak-dark` (absent from the real client). In `packages/client/src/styles/tokens.css`, add near the other semantic color tokens (after `--revisit-dark`):

```css
  --streak: var(--orange-300);
  --streak-dark: var(--orange-400);
```

- [ ] **Step 2: Create the component**

Create `packages/client/src/components/ActivityHeader.ts`:

```ts
import { html } from '@/lib/html';
import type { Activity } from '@/lib/types';
import './ActivityHeader.css';

/**
 * The global activity header: three metrics in a row — day streak, days/week
 * goal, problems/week goal. Goals show `actual / target` and turn green when met.
 */
export function ActivityHeader(activity: Activity): HTMLElement {
  const streak = stat('stat-streak', String(activity.streak), null, 'day streak');
  const days = stat(
    'stat-days', String(activity.daysActive), String(activity.daysGoal), 'days this week',
  );
  if (activity.daysActive >= activity.daysGoal) days.classList.add('complete');
  const problems = stat(
    'stat-problems', String(activity.problemsThisWeek), String(activity.problemsGoal), 'problems this week',
  );
  if (activity.problemsThisWeek >= activity.problemsGoal) problems.classList.add('complete');

  return html`<section class="activity" aria-label="Your activity">
    <div class="activity-head">
      ${streak}
      ${days}
      ${problems}
    </div>
  </section>`;
}

/** One metric column: a big number (optionally `/ target`) over an uppercase label. */
function stat(id: string, actual: string, target: string | null, label: string): HTMLElement {
  const of = target === null ? '' : ` / ${target}`;
  const el = html`<div class="stat">
    <span class="stat-num"><span></span><span class="stat-of"></span></span>
    <span class="stat-lbl"></span>
  </div>`;
  el.id = id;
  const nums = el.querySelectorAll('.stat-num > span');
  nums[0]!.textContent = actual;
  (nums[1] as HTMLElement).textContent = of;
  el.querySelector('.stat-lbl')!.textContent = label;
  return el;
}
```

- [ ] **Step 3: Create the CSS (ported from the mock)**

Create `packages/client/src/components/ActivityHeader.css`:

```css
/* Global activity header — three metrics in a row. Ported from the mock's
   .activity / .stat rules (docs/mocks/single-screen.css). */
.activity {
  margin: 0.85rem 1rem;
  padding: 0.85rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
}
.activity-head { display: flex; align-items: stretch; }
.stat {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  padding: 0 0.35rem;
}
.stat + .stat { border-left: 1px solid var(--border); }
.stat-num {
  font-size: 1.5rem;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--fg);
}
.stat-of { font-size: 1rem; font-weight: 700; color: var(--muted); }
.stat-lbl {
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  font-weight: 600;
  text-align: center;
  line-height: 1.25;
}
#stat-streak .stat-num { color: var(--streak-dark); }
.stat.complete .stat-num { color: var(--learn-dark); }
.stat.complete .stat-of { color: color-mix(in srgb, var(--learn-dark) 60%, var(--muted)); }
```

- [ ] **Step 4: Build the client**

Run: `npm --prefix packages/client run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/ActivityHeader.ts packages/client/src/components/ActivityHeader.css packages/client/src/styles/tokens.css
git commit -m "feat(client): ActivityHeader component + streak tokens"
```

---

## Task 9: `BookCard` component

**Files:**
- Create: `packages/client/src/components/BookCard.ts`
- Create: `packages/client/src/components/BookCard.css`

The card head is a `<button>` (tappable → view-book); pills are `<button>`/`<span>` with
`stopPropagation` so they don't fire the head nav. "Finished" = 100% + nothing due/scheduled.

- [ ] **Step 1: Create the component**

Create `packages/client/src/components/BookCard.ts`:

```ts
import { html } from '@/lib/html';
import { CoverSlot } from '@/components/CoverSlot';
import { daysUntil } from '@/lib/dates';
import type { Book, BookSummary } from '@/lib/types';
import './BookCard.css';

const ICON_REVISIT =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round">
     <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" /><path d="M21 3v5h-5" />
     <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 21v-5h5" />
   </svg>`;
const ICON_LEARN =
  `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z" /></svg>`;

export interface BookCardProps {
  book: Book & { summary: BookSummary };
  onOpen: () => void;
  onRevisit: () => void;
  onLearn: () => void;
}

/** A book is finished when fully mastered and nothing is due or scheduled. */
export function isFinished(s: BookSummary): boolean {
  return s.progress === 100 && s.dueNow === 0 && s.nextReviewDate === null;
}

export function BookCard({ book, onOpen, onRevisit, onLearn }: BookCardProps): HTMLElement {
  const s = book.summary;
  const finished = isFinished(s);

  const cover = CoverSlot({ title: book.title, isbn: book.isbn });

  const progClass = 'bc-progress' + (s.progress === 0 ? ' none' : '') + (s.progress === 100 ? ' complete' : '');
  const head = html`<button type="button" class="bc-head">
    ${cover}
    <div class="bc-text">
      <div class="b-title2"></div>
      <div class="b-author"></div>
    </div>
    <div class="${progClass}">
      <span class="bc-pct"></span><span class="bc-pct-lbl">done</span>
    </div>
  </button>`;
  head.querySelector('.b-title2')!.textContent = book.title;
  head.querySelector('.b-author')!.textContent = book.author ?? '';
  head.querySelector('.bc-pct')!.textContent = `${s.progress}%`;
  head.addEventListener('click', onOpen);

  const card = html`<div class="book-card">${head}</div>`;
  if (finished) card.classList.add('finished');

  // Finished books carry no pills — the green 100% is the whole story.
  if (!finished) {
    const actions = html`<div class="bc-actions"></div>`;
    if (s.dueNow > 0) {
      actions.appendChild(pill('revisit', ICON_REVISIT, `${s.dueNow} to revisit`, onRevisit));
    } else if (s.nextReviewDate !== null) {
      actions.appendChild(pill('revisit-soon', ICON_REVISIT, `Ready in ${daysUntil(s.nextReviewDate)}`, null));
    }
    if (s.learnNext !== null) {
      actions.appendChild(pill('learn', ICON_LEARN, `Start learning ${s.learnNext.pathPrefix}`, onLearn));
    }
    if (actions.childElementCount > 0) card.appendChild(actions);
  }

  return card;
}

/** A pill chip. Tappable pills are <button>s that stopPropagation (so they don't fire the head). */
function pill(kind: string, icon: string, label: string, onClick: (() => void) | null): HTMLElement {
  const tappable = onClick !== null;
  const el = document.createElement(tappable ? 'button' : 'span');
  el.className = `bc-pill bc-${kind}` + (tappable ? ' tappable' : '');
  if (tappable) {
    (el as HTMLButtonElement).type = 'button';
    el.addEventListener('click', (e) => { e.stopPropagation(); onClick!(); });
  }
  el.innerHTML = `<span class="bc-pill-icon" aria-hidden="true">${icon}</span><span class="bc-pill-text"></span>`;
  el.querySelector('.bc-pill-text')!.textContent = label;
  return el;
}
```

- [ ] **Step 2: Create the CSS (ported from the mock)**

Create `packages/client/src/components/BookCard.css` with the `.book-card`, `.bc-head`, `.b-cover`/`.b-cover-fallback`, `.bc-text`, `.bc-progress`, `.bc-actions`, `.bc-pill*` rules from `docs/mocks/single-screen.css` lines 109-277. Copy them verbatim EXCEPT: the cover is rendered by `CoverSlot` (class `.cover-slot`, not `.b-cover`), so add a sizing rule for it and keep the fallback rules for reference:

```css
/* Per-book card — head (cover + title + progress) opens the book; folded-in
   revisit/learn pills replace the old global banners. Ported from the mock's
   .book-card / .bc-* rules (docs/mocks/single-screen.css). */
.book-card {
  border-bottom: 1px solid var(--border);
  padding: 0.4rem 0 0.7rem;
}
.book-card.finished {
  background: color-mix(in srgb, var(--learn) 9%, var(--bg));
}
.book-card.finished .bc-head:active,
.book-card.finished .bc-head:hover {
  background: color-mix(in srgb, var(--learn) 16%, var(--bg));
}
.book-card.finished .b-title2 { color: var(--learn-dark); }

.bc-head {
  display: grid;
  grid-template-columns: 64px 1fr auto;
  grid-template-areas: "icon text progress";
  column-gap: 1rem;
  align-items: center;
  width: 100%;
  border: none;
  background: none;
  font: inherit;
  text-align: left;
  color: inherit;
  padding: 0.5rem 1.25rem;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.12s ease;
}
.bc-head:active { background: var(--surface); }
@media (hover: hover) { .bc-head:hover { background: var(--surface); } }

/* CoverSlot renders into .cover-slot; size it into the icon column. */
.bc-head .cover-slot {
  grid-area: icon;
  align-self: center;
  justify-self: center;
  width: 64px;
  height: 68px;
  border-radius: 3px;
  box-shadow: 3px 4px 7px rgba(0, 0, 0, 0.3);
  flex: none;
}

.bc-text { grid-area: text; min-width: 0; }
.bc-text .b-title2 {
  font-size: 1.05rem;
  font-weight: 600;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.bc-text .b-author { font-size: 0.85rem; color: var(--muted); margin-top: 0.15rem; }

.bc-progress {
  grid-area: progress;
  justify-self: end;
  text-align: right;
  line-height: 1.05;
}
.bc-pct { display: block; font-size: 1.05rem; font-weight: 700; color: var(--muted); }
.bc-pct-lbl {
  display: block;
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  margin-top: 0.1rem;
}
.bc-progress.none .bc-pct,
.bc-progress.none .bc-pct-lbl { color: var(--border); }
.bc-progress.complete .bc-pct,
.bc-progress.complete .bc-pct-lbl { color: var(--learn-dark); }

.bc-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding: 0.15rem 1.25rem 0.2rem calc(1.25rem + 64px + 1rem);
}
.bc-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid var(--border);
  background: var(--surface);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--fg);
  padding: 0.3rem 0.65rem;
  border-radius: 999px;
  line-height: 1;
}
.bc-pill .bc-pill-icon { flex: none; width: 0.9rem; height: 0.9rem; line-height: 0; }
.bc-pill .bc-pill-icon svg { width: 100%; height: 100%; display: block; }
.bc-pill .bc-pill-text { white-space: nowrap; }
.bc-pill.tappable {
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.08s ease, filter 0.12s ease, background 0.12s ease;
}
.bc-pill.tappable:active { transform: scale(0.97); }
.bc-revisit { color: #fff; background: var(--revisit); border-color: var(--revisit-dark); }
.bc-learn { color: #fff; background: var(--learn); border-color: var(--learn-dark); }
@media (hover: hover) {
  .bc-revisit:hover, .bc-learn:hover { filter: brightness(1.06); }
}
.bc-revisit-soon { color: var(--muted); background: var(--bg); }
```

- [ ] **Step 3: Build the client**

Run: `npm --prefix packages/client run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/components/BookCard.ts packages/client/src/components/BookCard.css
git commit -m "feat(client): BookCard component (cover + progress + revisit/learn pills)"
```

---

## Task 10: Rewrite `LandingPage`

**Files:**
- Modify: `packages/client/src/pages/LandingPage.ts` (full rewrite)
- Modify: `packages/client/src/pages/LandingPage.css`

- [ ] **Step 1: Rewrite the page**

Replace the entire contents of `packages/client/src/pages/LandingPage.ts` with:

```ts
import { html } from '@/lib/html';
import { Spinner } from '@/components/Spinner';
import { ActivityHeader } from '@/components/ActivityHeader';
import { BookCard, isFinished } from '@/components/BookCard';
import type { Activity, BookWithSummary } from '@/lib/types';
import './LandingPage.css';

/**
 * Home screen: a global activity header (streak + weekly goals) over the library
 * of per-book cards (cover + mastery progress + revisit/learn pills). One scrolling
 * region — the header and library scroll together.
 */
export function LandingPage(): HTMLElement {
  const headerHost = html`<div></div>`;
  const booksHost = html`<div></div>`;
  booksHost.appendChild(Spinner());

  const editBtn = html`<button class="edit-btn" aria-label="Edit library" title="Edit library">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
         stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  </button>`;
  editBtn.addEventListener('click', () => { window.location.hash = '#/manage-books'; });

  const addBtn = html`<button class="add-book">
    <span class="plus" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 5v14" /><path d="M5 12h14" />
      </svg>
    </span>
    <span>Add a book to your library</span>
  </button>`;
  addBtn.addEventListener('click', () => { window.location.hash = '#/add-book'; });

  const page = html`<div class="landing app anim-cascade">
    <div class="home-scroll">
      ${headerHost}
      <section class="library">
        <div class="library-head">
          <h2>Your library</h2>
          ${editBtn}
        </div>
        ${booksHost}
        ${addBtn}
      </section>
    </div>
  </div>`;

  void loadData(headerHost, booksHost);
  return page;
}

async function loadData(headerHost: HTMLElement, booksHost: HTMLElement): Promise<void> {
  const [activity, books] = await Promise.all([
    fetch('/api/activity').then((r) => r.json() as Promise<Activity>).catch(() => null),
    fetch('/api/books/summaries').then((r) => r.json() as Promise<BookWithSummary[]>).catch(() => [] as BookWithSummary[]),
  ]);

  if (activity) headerHost.replaceChildren(ActivityHeader(activity));
  else headerHost.replaceChildren();

  // Finished books (fully mastered, nothing due) sink to the bottom, stable order.
  const ordered = [...books].sort((a, b) => Number(isFinished(a.summary)) - Number(isFinished(b.summary)));

  booksHost.replaceChildren();
  ordered.forEach((book) => {
    booksHost.appendChild(BookCard({
      book,
      onOpen: () => { window.location.hash = `#/view-book?id=${encodeURIComponent(book.id)}`; },
      onRevisit: () => { window.location.hash = '#/revisit'; },
      onLearn: () => { window.location.hash = '#/learn'; },
    }));
  });
}
```

- [ ] **Step 2: Replace the page CSS**

Replace the entire contents of `packages/client/src/pages/LandingPage.css` with the home-shell +
library-head + add-book rules (ported from `docs/mocks/single-screen.css` lines 8-21, 75-107, 279-316),
scoped under `.landing`:

```css
/* Home screen shell: one scrolling region (activity header + library scroll
   together). Ported from docs/mocks/single-screen.css. */
.landing.app {
  height: 100dvh;
  display: grid;
  grid-template-rows: 1fr;
  overflow: hidden;
  max-width: 760px;
  margin: 0 auto;
}
.home-scroll {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-bottom: max(0.5rem, env(safe-area-inset-bottom));
}

.library { padding: 0.75rem 0 0.5rem; }
.library-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 1.25rem 0.4rem;
}
.library h2 {
  margin: 0;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.edit-btn {
  flex: none;
  border: none;
  background: none;
  padding: 0.2rem;
  cursor: pointer;
  color: var(--muted);
  line-height: 0;
  border-radius: 6px;
  transition: color 0.2s ease, background 0.12s ease;
}
.edit-btn svg { width: 1.1rem; height: 1.1rem; display: block; }
.edit-btn:active { color: var(--orange-200); }
@media (hover: hover) {
  .edit-btn:hover { background: var(--grey-50); color: var(--orange-200); }
}

.add-book {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  width: 100%;
  border: none;
  border-top: 1px solid var(--border);
  background: #fafafa;
  color: var(--fg);
  font: inherit;
  font-weight: 600;
  padding: 0.9rem 1.25rem;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.12s ease, color 0.2s ease;
}
.add-book:active { background: var(--surface); color: var(--orange-200); }
@media (hover: hover) {
  .add-book:hover { background: var(--surface); color: var(--orange-200); }
}
.add-book .plus {
  flex: none;
  width: 1.9rem;
  height: 1.9rem;
  line-height: 0;
  color: var(--muted);
  transition: color 0.2s ease;
}
.add-book:active .plus { color: var(--orange-200); }
@media (hover: hover) { .add-book:hover .plus { color: var(--orange-200); } }
.add-book .plus svg { width: 100%; height: 100%; display: block; }
```

- [ ] **Step 3: Build the client**

Run: `npm --prefix packages/client run build`
Expected: exit 0. (Note: `Banner`/`BookRow` are now unimported — they still exist on disk, deleted in Task 12.)

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/pages/LandingPage.ts packages/client/src/pages/LandingPage.css
git commit -m "feat(client): rewrite LandingPage with activity header + book cards"
```

---

## Task 11: LandingPage integration test (rewrite)

**Files:**
- Modify: `packages/client/tests/integration/LandingPage.test.ts` (full rewrite)

- [ ] **Step 1: Rewrite the test**

Replace the entire contents of `packages/client/tests/integration/LandingPage.test.ts` with:

```ts
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { LandingPage } from '@/pages/LandingPage';
import type { Activity, BookWithSummary } from '@/lib/types';

const activity: Activity = {
  streak: 5, daysActive: 3, problemsThisWeek: 12, daysGoal: 3, problemsGoal: 20,
};

const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
const books: BookWithSummary[] = [
  { id: 'b1', customerId: 'local', title: 'Quantum', author: 'Griffiths', isbn: '9781107179868',
    questionIds: [], createdAt: '2026-01-01T00:00:00Z',
    summary: { progress: 42, dueNow: 7, nextReviewDate: null, learnNext: { label: '3.1', pathPrefix: '3' } } },
  { id: 'b2', customerId: 'local', title: 'Calculus', questionIds: [], createdAt: '2026-01-01T00:00:00Z',
    summary: { progress: 68, dueNow: 0, nextReviewDate: future, learnNext: { label: '5.B.1', pathPrefix: '5' } } },
  { id: 'b3', customerId: 'local', title: 'Done Book', questionIds: [], createdAt: '2026-01-01T00:00:00Z',
    summary: { progress: 100, dueNow: 0, nextReviewDate: null, learnNext: null } },
];

function mockFetch(url: string): Promise<Response> {
  const body = url === '/api/activity' ? activity : books;
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
}

describe('LandingPage', () => {
  beforeEach(() => {
    window.location.hash = '#/';
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal('fetch', vi.fn(mockFetch));
  });
  afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

  test('renders the activity header with streak and goal metrics', async () => {
    document.getElementById('app')!.appendChild(LandingPage());
    await vi.waitFor(() => expect(document.querySelector('.activity')).not.toBeNull());
    expect(document.querySelector('#stat-streak')!.textContent).toContain('5');
    const days = document.querySelector('#stat-days')!;
    expect(days.textContent).toContain('3');
    expect(days.classList.contains('complete')).toBe(true); // 3 >= 3
    expect(document.querySelector('#stat-problems')!.classList.contains('complete')).toBe(false); // 12 < 20
  });

  test('renders one card per book with progress and pills', async () => {
    document.getElementById('app')!.appendChild(LandingPage());
    await vi.waitFor(() => expect(document.querySelectorAll('.book-card').length).toBe(3));

    const cardFor = (title: string): HTMLElement =>
      [...document.querySelectorAll('.book-card')].find(
        (c) => c.querySelector('.b-title2')!.textContent === title,
      ) as HTMLElement;

    // Book 1: due now → "7 to revisit" tappable pill + learn pill.
    const c1 = cardFor('Quantum');
    expect(c1.querySelector('.bc-pct')!.textContent).toBe('42%');
    expect(c1.querySelector('.bc-revisit')!.textContent).toContain('7 to revisit');
    expect(c1.querySelector('.bc-learn')!.textContent).toContain('Start learning 3');

    // Book 2: nothing due but scheduled → quiet "Ready in N days" pill.
    const c2 = cardFor('Calculus');
    expect(c2.querySelector('.bc-revisit-soon')!.textContent).toMatch(/Ready in \d+ days?/);
    expect(c2.querySelector('.bc-revisit')).toBeNull();
  });

  test('finished book sinks to the bottom and shows no pills', async () => {
    document.getElementById('app')!.appendChild(LandingPage());
    await vi.waitFor(() => expect(document.querySelectorAll('.book-card').length).toBe(3));
    const cards = [...document.querySelectorAll('.book-card')];
    const last = cards[cards.length - 1]!;
    expect(last.querySelector('.b-title2')!.textContent).toBe('Done Book');
    expect(last.classList.contains('finished')).toBe(true);
    expect(last.querySelector('.bc-actions')).toBeNull();
  });

  test('revisit pill navigates without triggering the card head', async () => {
    document.getElementById('app')!.appendChild(LandingPage());
    await vi.waitFor(() => expect(document.querySelector('.bc-revisit')).not.toBeNull());
    (document.querySelector('.bc-revisit') as HTMLButtonElement).click();
    expect(window.location.hash).toBe('#/revisit');
  });
});
```

- [ ] **Step 2: Run the full client suite**

Run: `npx vitest run --project client`
Expected: PASS (all client tests, including these 4).

- [ ] **Step 3: Commit**

```bash
git add packages/client/tests/integration/LandingPage.test.ts
git commit -m "test(client): rewrite LandingPage test for activity header + cards"
```

---

## Task 12: Delete orphaned `BookRow` and `Banner`

**Files:**
- Delete: `packages/client/src/components/BookRow.ts`, `packages/client/src/components/BookRow.css`
- Delete: `packages/client/src/components/Banner.ts`, `packages/client/src/components/Banner.css`

Both are imported ONLY by the old LandingPage (confirmed: `ManageBooksPage` uses `ManageBookRow`, a different component). The rewrite in Task 10 dropped both imports.

- [ ] **Step 1: Confirm no remaining importers**

Run: `grep -rn "BookRow\|Banner" packages/client/src --include=*.ts | grep -v "ManageBookRow"`
Expected: NO output (the only `*BookRow*`/`*Banner*` references left are `ManageBookRow`, filtered out). If anything else prints, STOP — there's an importer to handle first.

- [ ] **Step 2: Delete the files**

```bash
git rm packages/client/src/components/BookRow.ts packages/client/src/components/BookRow.css \
       packages/client/src/components/Banner.ts packages/client/src/components/Banner.css
```

- [ ] **Step 3: Build + full test suite**

Run: `npm --prefix packages/client run build && npm test`
Expected: exit 0; all tests pass (no dangling imports).

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(client): delete orphaned BookRow + Banner components"
```

---

## Task 13: Manual verification with seeded data

**Files:** none (verification only)

- [ ] **Step 1: Seed and start**

```bash
npx tsx packages/server/src/scripts/seed-dev.ts
npm run dev
```
(Or, if a built server is preferred: `rm -rf packages/server/dist packages/server/tsconfig.tsbuildinfo && npm --prefix packages/server run build && node packages/server/dist/index.js`, with the client dev server separately.)

- [ ] **Step 2: Verify the API**

Run: `curl -s http://127.0.0.1:3001/api/books/summaries` and `curl -s http://127.0.0.1:3001/api/activity`
Expected: `summaries` lists the seeded book with `progress`/`dueNow`/`nextReviewDate`/`learnNext`; `activity` returns `streak`/`daysActive`/`problemsThisWeek`/`daysGoal`/`problemsGoal`.

- [ ] **Step 3: Verify the page**

Open `http://localhost:5173/`. Confirm: activity header shows three metrics; each book is a card with cover + progress %; books with due problems show a purple "N to revisit" pill; books scheduled-but-not-due show a quiet "Ready in N days"; the seeded book's learn pill reads "Start learning <prefix>"; tapping a card opens view-book; tapping revisit/learn pills navigate to #/revisit and #/learn.

- [ ] **Step 4: No commit** (verification only). If issues found, fix in a follow-up task.

---

## Self-Review Notes

- **Spec coverage:** activity header (Tasks 3,5,8,11) · per-book cards (Tasks 2,4,9,10,11) · progress weighting (Task 2) · dueNow excludes skips (Task 2) · ISO nextReviewDate (Tasks 1,2) · pathPrefix not chapter (Tasks 1,2) · dedicated endpoints (Tasks 4,5) · finished sink-to-bottom (Tasks 9,10,11) · rolling-7-day window (Task 3) · delete BookRow/Banner (Task 12) · daysUntil extraction (Task 7) · verification with seed (Task 13). All covered.
- **Type consistency:** `summarizeBooks(books, questions, attempts, skippedIds, now)` used identically in Task 2 (def) and Task 4 (call). `computeActivity(attempts, now)` consistent Task 3↔5. `BookSummary`/`Activity` field names identical across server types (Task 1), client types (Task 7), service (Task 2,3), and tests. `isFinished` defined once (Task 9), imported by LandingPage (Task 10) and the test (Task 11).
- **Deferred (per spec):** settings UI, chapter discovery, completion-date ordering — not in any task by design.
```
