# Attempt History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a book's problems with a derived status badge + per-attempt grade strip in a read-only view, and let the user review and delete individual attempts.

**Architecture:** The server already owns the `Attempt` entity, the `GET/POST /api/questions/:id/attempts` routes, and the SRS schedule derivation (`scheduleFor`). This plan adds (a) a pure `deriveSummary(attempts)` service that returns `{ mastery, readiness, grades }`, (b) enriches the `GET /api/books/:bookId/questions` response so each problem carries that `summary`, and (c) a `DELETE /api/questions/:id/attempts/:attemptId` route. The client gains two pages — a read-only `ViewBookPage` (badge + CI strip per problem) and an `AttemptsPage` (expandable attempts, trash → confirm → delete) — plus shared `StatusBadge` / `CiStrip` components that replace the mock's throwaway `attempt-summary.js` heuristics. Mastery/readiness are derived **server-side** (single source of truth), so the client just renders.

**Tech Stack:** TypeScript, Express, supertest + vitest (server); framework-free TS + Navigo hash router + co-located CSS (client). PowerShell is the shell; the repo is a monorepo (`packages/server`, `packages/client`).

**Persistence: UNCHANGED (hard constraint).** No new persisted fields, no new collection, no migration, and no edits to `Store` / `Repository` / `JsonCollection`. `ProblemSummary` is derived in-memory on read and never stored. The only storage *operations* used are ones that already exist: `attempts.getAll` (read) and `attempts.delete` (already implemented and exercised by the cascade/batch-save paths). All new feature logic is pure.

---

## File Structure

**Server (new):**
- `packages/server/src/services/summary.ts` — pure `deriveSummary(attempts, now)` → `ProblemSummary`. The real-data equivalent of `docs/mocks/attempt-summary.js`. Composes `scheduleFor` (readiness) with a new mastery heuristic.
- `packages/server/src/services/summary.test.ts` — unit tests for the pure derivation.

**Server (modified):**
- `packages/server/src/domain/types.ts` — add `Mastery`, `Readiness`, `ProblemSummary`, and `QuestionWithSummary` types.
- `packages/server/src/routes/questions.ts` — enrich the book-questions GET list with `summary` per problem.
- `packages/server/src/routes/attempts.ts` — add the `DELETE /:attemptId` handler.
- `packages/server/src/uat/api-uat.test.ts` — add an "Attempt history" core flow + a segmentation case for attempt delete.

**Client (new):**
- `packages/client/src/lib/api.ts` — extend (or create the attempt-history calls if a generic fetch wrapper already exists; see Task 6 for the discovery step).
- `packages/client/src/components/StatusBadge.ts` + `.css` — word + readiness-color badge.
- `packages/client/src/components/CiStrip.ts` + `.css` — per-attempt grade ticks.
- `packages/client/src/pages/ViewBookPage.ts` + `.css` — read-only book view.
- `packages/client/src/pages/AttemptsPage.ts` + `.css` — attempt list + delete.

**Client (modified):**
- `packages/client/src/main.ts` — register `#/view-book` and `#/attempts` routes.
- `packages/client/src/styles/tokens.css` — add `--grade-*` and `--ready/--waiting/--finalized` tokens (ported from `docs/mocks/mocks.css`).
- Whichever page renders the library book rows (`LandingPage` or `ManageBooksPage` — confirm in Task 7) — make a book row navigate to `#/view-book?bookId=…`.

---

## Task 1: Summary domain types

**Files:**
- Modify: `packages/server/src/domain/types.ts` (append after the `Attempt` interface, ~line 66)

- [ ] **Step 1: Add the summary types**

Append to `packages/server/src/domain/types.ts`:

```typescript
/** Mastery word — how well a problem is known, derived from recent grade history. */
export type Mastery = 'new' | 'improving' | 'strong' | 'excellent';

/** Readiness — drives the badge color. ready = act now (purple), waiting = resting (grey), finalized = graduated (green). */
export type Readiness = 'ready' | 'waiting' | 'finalized';

/** Derived, never-persisted status for one problem — computed from its attempts. */
export interface ProblemSummary {
  mastery: Mastery;
  readiness: Readiness;
  /** Per-attempt grades, oldest first — backs the CI-history strip. */
  grades: Grade[];
}

/** A question plus its derived summary, as returned by the book-questions list. */
export type QuestionWithSummary = Question & { summary: ProblemSummary };
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (types are only declared, not yet used).

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/domain/types.ts
git commit -F - <<'EOF'
feat(server): add ProblemSummary domain types

Mastery word + readiness color + per-attempt grades for the
attempt-history view. Derivation lands next.
EOF
```

---

## Task 2: deriveSummary service (pure)

**Files:**
- Create: `packages/server/src/services/summary.ts`
- Test: `packages/server/src/services/summary.test.ts`

This ports the mock heuristic from `docs/mocks/attempt-summary.js` into real, tested code, composing the existing `scheduleFor` for readiness.

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/services/summary.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { Attempt, Grade } from '../domain/types.js';
import { deriveSummary } from './summary.js';

/** Build a minimal Attempt with the given grade (as `rating`) `daysAgo` days before `now`. */
function attempt(rating: Grade, daysAgo: number, now: string): Attempt {
  const createdAt = new Date(new Date(now).getTime() - daysAgo * 86_400_000).toISOString();
  return {
    id: `a-${daysAgo}-${rating}`,
    customerId: 'c',
    questionId: 'q',
    answer: 'x',
    recommendedGrade: rating,
    rating,
    issues: [],
    createdAt,
  };
}

const NOW = '2026-06-13T00:00:00.000Z';

describe('deriveSummary', () => {
  it('no attempts → new + ready, empty grades', () => {
    expect(deriveSummary([], NOW)).toEqual({ mastery: 'new', readiness: 'ready', grades: [] });
  });

  it('grades are returned oldest-first regardless of input order', () => {
    const a = [attempt('incorrect', 2, NOW), attempt('correct', 10, NOW)]; // newest-first input
    expect(deriveSummary(a, NOW).grades).toEqual(['correct', 'incorrect']);
  });

  it('all-correct recent history → excellent, and excellent is always finalized', () => {
    const a = [attempt('correct', 30, NOW), attempt('correct', 20, NOW), attempt('correct', 10, NOW)];
    const s = deriveSummary(a, NOW);
    expect(s.mastery).toEqual('excellent');
    expect(s.readiness).toEqual('finalized');
  });

  it('a recent fail history → improving, not excellent', () => {
    const a = [attempt('incorrect', 3, NOW), attempt('partial', 2, NOW), attempt('incorrect', 1, NOW)];
    expect(deriveSummary(a, NOW).mastery).toEqual('improving');
  });

  it('a non-excellent problem due now is ready; not-yet-due is waiting', () => {
    // One correct attempt 10 days ago: step 1 ⇒ 7-day interval ⇒ due 3 days ago ⇒ ready.
    const due = deriveSummary([attempt('correct', 10, NOW)], NOW);
    expect(due.readiness).toEqual('ready');
    // One partial attempt 1 day ago: step 0 ⇒ 7-day interval ⇒ due in 6 days ⇒ waiting.
    const resting = deriveSummary([attempt('partial', 1, NOW)], NOW);
    expect(resting.readiness).toEqual('waiting');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @qb/server -- summary`
Expected: FAIL — `Cannot find module './summary.js'`.

(If `-w @qb/server` is not the correct workspace name, check `packages/server/package.json` `name` and use that. The fallback `npx vitest run packages/server/src/services/summary.test.ts` also works from repo root.)

- [ ] **Step 3: Write the implementation**

Create `packages/server/src/services/summary.ts`:

```typescript
import type { Attempt, Grade, Mastery, ProblemSummary, Readiness } from '../domain/types.js';
import { scheduleFor } from './srs.js';

/** Numeric weight per grade for the mastery average. */
const GRADE_WEIGHT: Record<Grade, number> = { correct: 1, partial: 0.5, incorrect: 0 };

/** How many recent attempts feed the mastery word. */
const MASTERY_WINDOW = 4;

/**
 * Mastery word from the (oldest-first) grade list: weighted average of the last
 * few attempts. No attempts ⇒ 'new'. Mirrors docs/mocks/attempt-summary.js.
 */
function masteryFrom(grades: Grade[]): Mastery {
  if (grades.length === 0) return 'new';
  const recent = grades.slice(-MASTERY_WINDOW);
  const score = recent.reduce((s, g) => s + GRADE_WEIGHT[g], 0) / recent.length;
  if (score >= 0.85) return 'excellent';
  if (score >= 0.6) return 'strong';
  return 'improving';
}

/**
 * Readiness drives the badge color. An excellent problem is graduated ('finalized'),
 * never scheduled. A problem with no attempts is always 'ready' (incl. brand-new).
 * Otherwise the SRS schedule decides: due at/before `now` ⇒ 'ready', else 'waiting'.
 */
function readinessFrom(attempts: Attempt[], mastery: Mastery, now: string): Readiness {
  if (mastery === 'excellent') return 'finalized';
  const schedule = scheduleFor(attempts, now);
  if (schedule === null) return 'ready';
  return schedule.nextReviewDate <= now ? 'ready' : 'waiting';
}

/**
 * Derive the full per-problem summary from its attempts. Pure and total: the
 * single source of truth for the status badge + CI-history strip. `attempts` may
 * be in any order; `now` is an ISO timestamp.
 */
export function deriveSummary(attempts: Attempt[], now: string): ProblemSummary {
  const ordered = [...attempts].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );
  const grades = ordered.map((a) => a.rating);
  const mastery = masteryFrom(grades);
  const readiness = readinessFrom(attempts, mastery, now);
  return { mastery, readiness, grades };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w @qb/server -- summary`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/summary.ts packages/server/src/services/summary.test.ts
git commit -F - <<'EOF'
feat(server): deriveSummary — mastery word + readiness color from attempts

Pure derivation composing the existing SRS schedule. Ports the mock
heuristic in docs/mocks/attempt-summary.js into tested real code; this
is the single source of truth for the status badge.
EOF
```

---

## Task 3: Enrich the book-questions list with summary

**Files:**
- Modify: `packages/server/src/routes/questions.ts:38-56` (the `bookQuestionsRouter` GET handler)

- [ ] **Step 1: Add the failing assertion to the route test**

There is no dedicated `questions.test.ts` route test; the UAT (Task 5) is the acceptance gate. Skip straight to implementation here and let Task 5's flow assert it end-to-end. (If a `packages/server/src/routes/questions.test.ts` exists, add a case asserting `body[0].summary` is present; otherwise proceed.)

- [ ] **Step 2: Implement the enrichment**

In `packages/server/src/routes/questions.ts`:

Add to the imports at the top:

```typescript
import { nowIso } from '../domain/ids.js';
import { deriveSummary } from '../services/summary.js';
import type { Attempt } from '../domain/types.js';
```

(Note: `newId, nowIso` is already imported on line 2 — extend that existing import rather than adding a duplicate. The line currently reads `import { newId, nowIso } from '../domain/ids.js';` — leave it as is.)

Replace the final `res.json(orderByIds(healed, questions));` in the GET handler (line 55) with:

```typescript
    const ordered = orderByIds(healed, questions);
    const attempts = await store.attempts.getAll(customerId);
    const byQuestion = new Map<string, Attempt[]>();
    for (const a of attempts) {
      const list = byQuestion.get(a.questionId);
      if (list) list.push(a);
      else byQuestion.set(a.questionId, [a]);
    }
    const now = nowIso();
    res.json(
      ordered.map((q) => ({ ...q, summary: deriveSummary(byQuestion.get(q.id) ?? [], now) })),
    );
```

Remove the unused `import type { Attempt }` line if `Attempt` ends up referenced only here — it IS referenced (the `Map<string, Attempt[]>`), so keep it.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Run the full server test suite to confirm no regression**

Run: `npm run test -w @qb/server`
Expected: PASS — existing UAT flows that read `GET /books/:id/questions` still pass (they assert `.map(q => q.id)` / `.canonicalText`, which survive the spread; the new `summary` key is additive).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/questions.ts
git commit -F - <<'EOF'
feat(server): attach derived summary to the book-questions list

Each problem in GET /books/:id/questions now carries a summary
{ mastery, readiness, grades } so the read-only book view renders the
status badge + CI strip from one fetch.
EOF
```

---

## Task 4: DELETE an attempt

**Files:**
- Modify: `packages/server/src/routes/attempts.ts` (add a handler inside `questionAttemptsRouter`, after the POST, before `return router;`)

- [ ] **Step 1: Implement the DELETE handler**

In `packages/server/src/routes/attempts.ts`, add before `return router;` (after the POST handler, ~line 79):

```typescript
  router.delete('/:attemptId', async (req, res) => {
    const customerId = requireCustomerId(req);
    const { id: questionId, attemptId } = req.params as { id: string; attemptId: string };
    if (!(await store.questions.getById(customerId, questionId))) {
      res.status(404).json({ error: 'question not found' });
      return;
    }
    const existing = await store.attempts.getById(customerId, attemptId);
    // 404 unless the attempt exists AND belongs to this question — never a no-op 204 that
    // hides a wrong id, and never lets one question delete another's attempt.
    if (!existing || existing.questionId !== questionId) {
      res.status(404).json({ error: 'attempt not found' });
      return;
    }
    await store.attempts.delete(customerId, attemptId);
    res.status(204).end();
  });
```

(`store.attempts.delete` is customer-scoped and a no-op for the wrong owner — see `Repository` contract — but we 404 first so the client gets a clear not-found rather than a silent 204.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run the server suite**

Run: `npm run test -w @qb/server`
Expected: PASS (no test exercises delete yet; Task 5 adds it).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/attempts.ts
git commit -F - <<'EOF'
feat(server): DELETE /questions/:id/attempts/:attemptId

Hard-delete one attempt; the SRS schedule re-derives automatically since
it is pure over history. 404 when the attempt is missing or belongs to a
different question/customer.
EOF
```

---

## Task 5: UAT coverage — attempt history flow + segmentation

**Files:**
- Modify: `packages/server/src/uat/api-uat.test.ts`

Extend the existing UAT (do not create a parallel file). Add one core flow to the first `describe` block and one segmentation case to the security block. Also update the FLOW COVERAGE MAP comment.

- [ ] **Step 1: Add the core "Attempt history" flow**

In `packages/server/src/uat/api-uat.test.ts`, inside `describe('UAT: API flows on the flat problems model', …)`, add this `it` after the Cascade-delete flow (after line ~413, before the `scriptProvider` helper definition):

```typescript
  // -------------------------------------------------------------------------
  // 9. ATTEMPT HISTORY — the read-only book view + attempt review/delete. The
  //    book-questions list carries a derived summary per problem (mastery word,
  //    readiness color, per-attempt grades), and an individual attempt can be
  //    deleted, after which the summary re-derives from the remaining history.
  // -------------------------------------------------------------------------
  it('Attempt history: list carries derived summary; deleting an attempt re-derives it', async () => {
    const book = await createBook();
    const [q] = await saveProblems(book.id, [{ label: '1', canonicalText: 'Solve x + 2 = 6' }]);

    // A brand-new (un-attempted) problem reads as new + ready, with no grades.
    const fresh = (await request(app).get(`/api/books/${book.id}/questions`)).body;
    expect(fresh[0].summary).toEqual({ mastery: 'new', readiness: 'ready', grades: [] });

    // Record two attempts: an incorrect then a correct.
    const a1 = await request(app)
      .post(`/api/questions/${q.id}/attempts`)
      .send({ answer: 'x = 5', recommendedGrade: 'incorrect', rating: 'incorrect', issues: [] });
    expect(a1.status).toEqual(201);
    const a2 = await request(app)
      .post(`/api/questions/${q.id}/attempts`)
      .send({ answer: 'x = 4', recommendedGrade: 'correct', rating: 'correct', issues: [] });
    expect(a2.status).toEqual(201);

    // The summary now reflects both grades, oldest-first.
    const withHistory = (await request(app).get(`/api/books/${book.id}/questions`)).body;
    expect(withHistory[0].summary.grades).toEqual(['incorrect', 'correct']);

    // Delete the incorrect attempt — 204, and it drops out of the list + the summary.
    const del = await request(app).delete(`/api/questions/${q.id}/attempts/${a1.body.id}`);
    expect(del.status).toEqual(204);

    const remaining = (await request(app).get(`/api/questions/${q.id}/attempts`)).body;
    expect(remaining.map((a: { id: string }) => a.id)).toEqual([a2.body.id]);

    const reDerived = (await request(app).get(`/api/books/${book.id}/questions`)).body;
    expect(reDerived[0].summary.grades).toEqual(['correct']);

    // Deleting an unknown attempt id, or one not on this question, is a clean 404.
    expect((await request(app).delete(`/api/questions/${q.id}/attempts/ghost`)).status).toEqual(404);
  });
```

- [ ] **Step 2: Run the new flow to verify it passes**

Run: `npm run test -w @qb/server -- api-uat`
Expected: PASS — the new flow plus all existing flows green.

- [ ] **Step 3: Add the segmentation case for attempt delete**

In the security `describe('UAT (security): customer segmentation is airtight', …)`, add after the "A cannot read B's question nor list/create its attempts" case (~line 540):

```typescript
  it('A cannot delete B\'s attempt (wrong-owner is 404, and B\'s attempt survives)', async () => {
    const { questionId } = await seedChain(B);
    const bAttemptId = (await as(request(segApp).get(`/api/questions/${questionId}/attempts`), B)).body[0].id;

    // A probing the delete endpoint on B's question/attempt is 404 — never confirms existence.
    expect(
      (await as(request(segApp).delete(`/api/questions/${questionId}/attempts/${bAttemptId}`), A)).status,
    ).toEqual(404);

    // B's attempt is untouched.
    const bAttempts = await as(request(segApp).get(`/api/questions/${questionId}/attempts`), B);
    expect(bAttempts.body).toHaveLength(1);
  });
```

- [ ] **Step 4: Update the FLOW COVERAGE MAP comment**

In the file header comment, add to the numbered FLOW COVERAGE MAP (after item 9 Segmentation, renumber is unnecessary — append):

```
*  10. Attempt history .. read-only book view summary (mastery/readiness/grades)
*                          + DELETE one attempt → summary re-derives; wrong-owner
*                          delete is 404.
```

- [ ] **Step 5: Run the entire server suite**

Run: `npm run test -w @qb/server`
Expected: PASS — every flow, including both new cases.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/uat/api-uat.test.ts
git commit -F - <<'EOF'
test(server): UAT for attempt history — summary + delete + segmentation

Core flow: book-questions summary re-derives after deleting an attempt.
Security flow: A cannot delete B's attempt (404, B's survives).
EOF
```

---

## Task 6: Client API calls for attempt history

**Files:**
- Discover: how the client currently calls the API (look for an existing wrapper).
- Modify/Create: the client API layer.

- [ ] **Step 1: Discover the existing API-call pattern**

Run:

```bash
grep -rn "fetch(" packages/client/src --include=*.ts | head -30
ls packages/client/src/lib
```

Identify whether there is a central fetch wrapper (e.g. `lib/api.ts`) or each page calls `fetch` directly. Follow whichever pattern already exists — do NOT introduce a new abstraction if pages call `fetch` inline. The rest of this task assumes a thin `lib/api.ts`; if pages inline `fetch`, inline these calls in Tasks 8–9 instead and skip the file creation.

- [ ] **Step 2: Add the typed API calls**

Mirroring the server types, add (to `packages/client/src/lib/api.ts` if it exists, else co-locate in the pages). These shapes must match the server exactly:

```typescript
export type Grade = 'correct' | 'partial' | 'incorrect';
export type Mastery = 'new' | 'improving' | 'strong' | 'excellent';
export type Readiness = 'ready' | 'waiting' | 'finalized';

export interface ProblemSummary {
  mastery: Mastery;
  readiness: Readiness;
  grades: Grade[];
}

export interface GradingIssue {
  severity: 'critical' | 'medium' | 'minor';
  description: string;
}

export interface Attempt {
  id: string;
  questionId: string;
  answer: string;
  recommendedGrade: Grade;
  rating: Grade;
  issues: GradingIssue[];
  createdAt: string;
}

export interface QuestionWithSummary {
  id: string;
  bookId: string;
  label: string;
  canonicalText: string;
  summary: ProblemSummary;
}

/** Read-only: a book record. (Reuse the existing Book type if one is already defined.) */
export async function getBook(bookId: string): Promise<{ id: string; title: string; author?: string; isbn?: string }> {
  const res = await fetch(`/api/books/${bookId}`);
  if (!res.ok) throw new Error(`getBook ${res.status}`);
  return res.json();
}

export async function getBookQuestions(bookId: string): Promise<QuestionWithSummary[]> {
  const res = await fetch(`/api/books/${bookId}/questions`);
  if (!res.ok) throw new Error(`getBookQuestions ${res.status}`);
  return res.json();
}

export async function getAttempts(questionId: string): Promise<Attempt[]> {
  const res = await fetch(`/api/questions/${questionId}/attempts`);
  if (!res.ok) throw new Error(`getAttempts ${res.status}`);
  return res.json();
}

export async function deleteAttempt(questionId: string, attemptId: string): Promise<void> {
  const res = await fetch(`/api/questions/${questionId}/attempts/${attemptId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`deleteAttempt ${res.status}`);
}
```

Reuse any existing `Book` / `Question` types and fetch helpers rather than redefining — adapt the snippet to the codebase's conventions found in Step 1.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/lib/api.ts
git commit -F - <<'EOF'
feat(client): typed API calls for attempt history

getBookQuestions (with summary), getAttempts, deleteAttempt — shapes
mirror the server domain types.
EOF
```

---

## Task 7: Status tokens + book-row navigation

**Files:**
- Modify: `packages/client/src/styles/tokens.css`
- Discover + Modify: the library book-row renderer.

- [ ] **Step 1: Port the status tokens**

Open `docs/mocks/mocks.css` and find the `--grade-*`, `--ready`, `--waiting`, `--finalized` custom properties (the ones referenced by `.status-badge`, `.ready-*`, `.ci-tick`). Append them to `packages/client/src/styles/tokens.css` under a clearly-labelled section:

```css
/* --- Attempt-history status palette (ported from docs/mocks/mocks.css) --- */
/* CI-history ticks: incorrect = orange, partial = green OUTLINE, correct = solid green. */
--grade-correct: <value from mock>;
--grade-partial: <value from mock>;
--grade-incorrect: <value from mock>;
/* Readiness (badge color): ready = act-now purple, waiting = resting grey, finalized = graduated green. */
--ready: <value from mock>;
--waiting: <value from mock>;
--finalized: <value from mock>;
```

Copy the actual hex/token values from the mock — do not invent them. Confirm against the final mock: **incorrect = orange, partial = green outline, correct = solid green** (the user confirmed this exact mapping; the chat-pill green-solid question is a separate `grade.html` concern, out of scope here).

- [ ] **Step 2: Discover which page renders the library book rows**

Run:

```bash
grep -rln "BookRow" packages/client/src/pages
grep -rn "navigate\|router\|href=\"#/" packages/client/src/pages/LandingPage.ts packages/client/src/pages/ManageBooksPage.ts
```

The mock's `index.html` made book rows tappable → `view-book.html?isbn=NNN`. Find the equivalent page (likely `LandingPage`) where a book row is rendered and currently either does nothing or routes to edit/learn.

- [ ] **Step 3: Make a book row navigate to the read-only view**

In the identified page, wire each book row's tap to `#/view-book?bookId=<book.id>`. Use the same navigation idiom already used in that page (Navigo `router.navigate(...)` or an `<a href="#/...">`). Use `bookId` (the stable id), not `isbn` — the mock used isbn only because it had no ids. Example, adapting to the existing row component:

```typescript
row.addEventListener('click', () => {
  router.navigate(`/view-book?bookId=${book.id}`);
});
```

If the book row already navigates elsewhere (e.g. edit-book) and that must be preserved, follow the design decision in HANDOFF: view and edit are independent. Add view-book as the row's primary tap target only if that matches current UX; otherwise add a distinct affordance. When unsure, STOP and ask the user before changing existing navigation.

- [ ] **Step 4: Typecheck + manual smoke**

Run: `npm run typecheck`
Expected: PASS. (Visual verification happens in Task 10.)

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/styles/tokens.css packages/client/src/pages/LandingPage.ts
git commit -F - <<'EOF'
feat(client): status palette tokens + book row → view-book nav

Port the grade/readiness color tokens from the mock; tapping a library
book opens the read-only attempt-history view.
EOF
```

---

## Task 8: StatusBadge + CiStrip components

**Files:**
- Create: `packages/client/src/components/StatusBadge.ts` + `StatusBadge.css`
- Create: `packages/client/src/components/CiStrip.ts` + `CiStrip.css`

These are the real-data equivalents of `docs/mocks/attempt-summary.js` `badgeEl` / `ciStripEl`, but they take a server-derived `ProblemSummary` — no client-side heuristics.

- [ ] **Step 1: Write the StatusBadge component**

Create `packages/client/src/components/StatusBadge.ts` (match the existing component idiom — check another component like `ProblemRow.ts` first for the export/render pattern):

```typescript
import './StatusBadge.css';
import type { Mastery, Readiness } from '@/lib/api';

const MASTERY_LABEL: Record<Mastery, string> = {
  new: 'New',
  improving: 'Improving',
  strong: 'Strong',
  excellent: 'Excellent',
};

/** Word = mastery; color class = readiness (purple ready / grey waiting / green finalized). */
export function StatusBadge(mastery: Mastery, readiness: Readiness): HTMLElement {
  const el = document.createElement('span');
  el.className = `status-badge ready-${readiness}`;
  el.textContent = MASTERY_LABEL[mastery];
  return el;
}
```

Create `packages/client/src/components/StatusBadge.css` — port the `.status-badge` and `.ready-ready` / `.ready-waiting` / `.ready-finalized` rules from `docs/mocks/mocks.css` (they reference the tokens added in Task 7).

- [ ] **Step 2: Write the CiStrip component**

Create `packages/client/src/components/CiStrip.ts`:

```typescript
import './CiStrip.css';
import type { Grade } from '@/lib/api';

/** Per-attempt grade ticks, oldest→newest. `large` uses the bigger variant; `cap` keeps the newest N. */
export function CiStrip(grades: Grade[], opts: { large?: boolean; cap?: number } = {}): HTMLElement {
  const strip = document.createElement('span');
  strip.className = 'ci-strip' + (opts.large ? ' lg' : '');
  const list = opts.cap && opts.cap > 0 ? grades.slice(-opts.cap) : grades;
  for (const g of list) {
    const tick = document.createElement('span');
    tick.className = `ci-tick t-${g}`;
    tick.title = g;
    strip.appendChild(tick);
  }
  return strip;
}
```

Create `packages/client/src/components/CiStrip.css` — port `.ci-strip`, `.ci-strip.lg`, `.ci-tick`, and `.t-correct` / `.t-partial` / `.t-incorrect` from `docs/mocks/mocks.css`. Verify: **`.t-incorrect` = orange fill, `.t-partial` = green outline (transparent fill, green border), `.t-correct` = solid green fill.**

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/components/StatusBadge.ts packages/client/src/components/StatusBadge.css packages/client/src/components/CiStrip.ts packages/client/src/components/CiStrip.css
git commit -F - <<'EOF'
feat(client): StatusBadge + CiStrip components

Real-data equivalents of the mock's attempt-summary.js, rendering the
server-derived summary. Incorrect=orange, partial=green-outline,
correct=solid-green ticks.
EOF
```

---

## Task 9: ViewBookPage + AttemptsPage

**Files:**
- Create: `packages/client/src/pages/ViewBookPage.ts` + `ViewBookPage.css`
- Create: `packages/client/src/pages/AttemptsPage.ts` + `AttemptsPage.css`
- Modify: `packages/client/src/main.ts`

Mirror `docs/mocks/view-book.html` and `docs/mocks/attempts-filled.html`. Read both mock files first to match layout/structure; reuse `CoverSlot`/`TopBar` components where the mock has the equivalent.

- [ ] **Step 1: Register the routes**

In `packages/client/src/main.ts`, add the imports and routes (Navigo, hash mode — query params come via `location.search` or Navigo's match data; check how other pages read params, e.g. `EditBookPage`):

```typescript
import { ViewBookPage } from '@/pages/ViewBookPage';
import { AttemptsPage } from '@/pages/AttemptsPage';
```

```typescript
  .on('/view-book', () => mount(ViewBookPage))
  .on('/attempts', () => mount(AttemptsPage))
```

`mount` calls `page()` with no args, so each page reads its own query param (`bookId` / `questionId`) from the URL the same way existing pages do. Confirm the existing param-reading idiom in `EditBookPage.ts` and reuse it.

- [ ] **Step 2: Build ViewBookPage**

Create `packages/client/src/pages/ViewBookPage.ts`. It should:
1. Read `bookId` from the URL (same idiom as EditBookPage).
2. `getBook(bookId)` for the title/cover header; `getBookQuestions(bookId)` for the list.
3. Render each problem as a row: label + `canonicalText` preview + `StatusBadge(summary.mastery, summary.readiness)` + `CiStrip(summary.grades, { cap: 8 })`.
4. Each row navigates to `#/attempts?questionId=<q.id>`.
5. A back affordance to the library (the mock's "Library" back button → `#/`).
6. NO edit pencil — view and edit stay independent (per the settled design).

Match the visual structure of `docs/mocks/view-book.html`. Co-locate `ViewBookPage.css` (port from `docs/mocks/view-book.css`). Use existing components (`CoverSlot`, `TopBar`) for the header if the mock uses an equivalent.

- [ ] **Step 3: Build AttemptsPage**

Create `packages/client/src/pages/AttemptsPage.ts`. It should:
1. Read `questionId` from the URL.
2. `getAttempts(questionId)`; render newest-first.
3. Each attempt is an expandable row showing `answer` and, when expanded, its `issues` (severity + description) and a relative date (port the mock's `relDate()` formatter from `attempts-filled.html`; it works off `createdAt` ISO strings now, not the mock's `daysAgo`).
4. Each attempt has a trash button → a confirm step (the mock's two-tap trash→confirm) → `deleteAttempt(questionId, attempt.id)` → remove the row from the DOM on success.
5. Empty state: "No attempts yet" when the list is empty (mock's `p=3` state).
6. A back affordance to the originating book view. The book id is needed for that link — pass it through the URL too: navigate from ViewBookPage as `#/attempts?questionId=<q.id>&bookId=<bookId>` and have AttemptsPage read both, so Back returns to `#/view-book?bookId=<bookId>`. (HANDOFF settled: Back returns to view-book, not edit-book.)

Co-locate `AttemptsPage.css` (port from `docs/mocks/attempts.css`).

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build -w @qb/client` (or the repo's client build script — check `package.json`)
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/pages/ViewBookPage.ts packages/client/src/pages/ViewBookPage.css packages/client/src/pages/AttemptsPage.ts packages/client/src/pages/AttemptsPage.css packages/client/src/main.ts
git commit -F - <<'EOF'
feat(client): ViewBookPage + AttemptsPage

Read-only book view (status badge + CI strip per problem) and an attempt
list with expand + delete (trash → confirm). Ports view-book.html and
attempts-filled.html; Back returns to the book view.
EOF
```

---

## Task 10: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full test + typecheck gate**

Run: `npm run typecheck && npm run test`
Expected: PASS across both packages — every server unit/route test, the full UAT suite (incl. the two new attempt-history flows), and any client tests.

- [ ] **Step 2: Manual smoke against the running app**

Start the dev servers (check `package.json` for the scripts — likely `npm run dev` runs server + client). Then walk the real flow:
1. Open the client, tap a library book → lands on `#/view-book?bookId=…`.
2. Each problem shows a badge (word + color) and a grade strip matching its attempts.
3. Tap a problem → `#/attempts?questionId=…&bookId=…`.
4. Expand an attempt (see answer + issues + date); trash → confirm → it disappears.
5. Back returns to the book view; the deleted attempt's grade is gone from that problem's strip (summary re-derived).
6. A problem with no attempts shows "New"/ready and an empty "No attempts yet" state.

Expected: every step works; badge colors match the mock (purple ready / grey waiting / green finalized; orange / green-outline / solid-green ticks).

- [ ] **Step 3: Final verification using the verification-before-completion skill**

Before claiming done, run the verification-before-completion skill's checklist: confirm each command's output, don't assert "passing" without the green run in hand.

- [ ] **Step 4: Report**

Summarize what landed, paste the final `npm run test` summary line, and note the two open mock-only threads that are intentionally OUT of scope: the `grade.html` chat-pill color question and any view↔edit linking. Do not commit those.

---

## Self-Review Notes

- **Spec coverage:** read-only book view (Task 9), status badge word+color (Tasks 2,8,9), CI strip with the confirmed orange/green-outline/solid-green mapping (Tasks 7,8), attempt list + expand + delete (Tasks 4,9), empty state (Task 9), summary derived server-side (Tasks 2,3), UAT incl. delete + segmentation (Task 5). All covered.
- **Type consistency:** `ProblemSummary { mastery, readiness, grades }`, `Mastery`, `Readiness`, `Grade` are defined once (Task 1) and mirrored on the client (Task 6) with identical member names; `deriveSummary(attempts, now)` signature is used identically in Tasks 2, 3.
- **Discovery steps flagged:** Tasks 6, 7, 9 each begin by inspecting the existing client conventions (fetch pattern, param-reading idiom, component export shape, book-row page) rather than assuming — because the client structure wasn't fully read when planning. Follow what's there; don't impose a new abstraction.
- **Out of scope (do not touch):** `edit-book` / `problems-list.js` badge (reverted deliberately), the `grade.html` chat-pill color question, any view↔edit cross-linking.
```

