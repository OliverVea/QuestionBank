# Flat Problems API Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the QuestionBank server API so a book owns a flat, ordered list of problems (`questionIds: string[]`), removing chapters entirely, removing all persisted images, and reducing writes to exactly two commits (book Save + save attempt).

**Architecture:** Clean rewrite, no migration. `Question` re-roots from `chapterId` to `bookId`; order/membership live in `book.questionIds`. `GET /books/:bookId/questions` reconciles defensively and is the render authority. A single batch `PUT /books/:bookId/questions` diffs the full ordered list (create/update/delete) in one atomic operation. The LLM endpoints (`extract`, `transcribe`, `grade`) become read-only — they take image bytes transiently and persist nothing. A new read-only `GET /lookup/isbn/:isbn` backs metadata prefill. The `Chapter` entity, `chapters.json`, `services/tree.ts`, and the `images/` directory all go away.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Express 5, Vitest + Supertest, in-memory `JsonCollection` JSON store, `FakeProvider` for LLM tests.

---

## Orientation for the implementer (read before Task 1)

You have **zero assumed context**. Key facts about this codebase:

- **Monorepo.** The server lives at `packages/server`. Run all commands from the repo root `C:\Users\olive\QuestionBank`. Tests run with `npx vitest run <path>` (the root `vitest.config.ts` already excludes `dist/` and loads `packages/server/src/test-setup.ts`, which sets `QB_ALLOW_DEFAULT_CUSTOMER=1` so route tests resolve to the `"local"` customer without identity headers). Typecheck with `npm run typecheck` from the root.
- **ESM import rule.** Imports of local `.ts` files are written with a `.js` extension (e.g. `import { Store } from './storage/store.js'`). This is mandatory — `tsc` emits `.js` and Node resolves it. Match it exactly.
- **Every entity has `{ id: string; customerId: string }`.** The `Repository<T>` / `JsonCollection<T>` generic requires it. Routes call `requireCustomerId(req)` and pass the id explicitly into every store call. Wrong-owner is treated as not-found (see `storage/repository.ts`).
- **`JsonCollection.update` shallow-merges and CANNOT delete a key.** Replacing an array-valued field (like `questionIds`) with a new array is fine (it's a merge of one key to a new value, not a key removal). Deleting a *row* uses `delete(customerId, id)`, which works. You will rely on both.
- **Test pattern (canonical).** Every route test does: `mkdtemp` a temp dir → `Store.open(dir)` → `createApp(store, new FakeProvider(), new ImageStore(dir))` → `supertest(app)`; `afterEach` `rm`s the dir. Copy this harness in every new route test. `FakeProvider` returns `{ questions: [] }` from `completeStructured` by default; pass `new FakeProvider({ structured: {...} })` to control output, and `provider.failWith(new LlmError('x'))` to force a 502 path.
- **IDs & time.** `newId()` and `nowIso()` come from `domain/ids.js`. Never inline `randomUUID`/`new Date()` in routes.

**Source of truth for the design:** `docs/superpowers/specs/2026-06-10-api-overview.md`. If this plan and the spec ever disagree, the spec wins — stop and reconcile.

---

## File Structure

**Deleted (chapter model + persisted images — entirely removed):**
- `packages/server/src/routes/chapters.ts` and `routes/chapters.test.ts`
- `packages/server/src/services/tree.ts` and `services/tree.test.ts`
- `packages/server/src/services/cascade.ts` and `services/cascade.test.ts` (replaced by a book-level cascade inside `books.ts` or a slimmer `cascade.ts`)
- `packages/server/src/storage/images.ts` and `storage/images.test.ts`
- The `Chapter` interface and `Relevance` type in `domain/types.ts`

**Created:**
- `packages/server/src/services/reconcile.ts` (+ test) — pure reconcile of `questionIds` vs. stored questions.
- `packages/server/src/services/batch-save.ts` (+ test) — diff the incoming ordered list against stored state into create/update/delete + new `questionIds`.
- `packages/server/src/routes/lookup.ts` (+ test) — `GET /lookup/isbn/:isbn`.
- `packages/server/src/services/isbn-lookup.ts` (+ test) — the external-catalog fetch, behind an injectable function for testing.

**Modified:**
- `domain/types.ts` — new `Book` (adds `isbn?/publisher?/year?/questionIds`), new `Question` (`bookId`, required `label`, no order/relevance/skip/snooze/nextReviewDate), new `Attempt` (single `answer`, no image paths), `QuestionSource` loses `imagePath`.
- `storage/store.ts` — drop the `chapters` collection.
- `routes/books.ts` — add metadata fields; book delete cascades questions+attempts directly (no chapters).
- `routes/questions.ts` — becomes the `GET/PUT /books/:bookId/questions` batch surface + `GET /questions/:id`.
- `routes/attempts.ts` — single `answer` field, no `imagePaths`.
- `routes/transcribe.ts` — image bytes in, transcription text out, nothing saved.
- `routes/grade.ts` — drop chapter lookup from grading context.
- `routes/learn.ts` + `services/learn-next.ts` — order by `book.questionIds` position, drop skip/snooze.
- `routes/practice.ts` + `services/due-queue.ts` — drop `skipped`, drop chapter context.
- `index.ts` — rewire routers (remove chapter + nested-chapter mounts, add lookup, remount questions under `/books/:bookId/questions`).

> **Decomposition note:** the rewrite touches everything, so tasks are ordered **bottom-up** — types → store → reconcile/batch services → routes → queues → LLM endpoints → lookup → cleanup. Each task ends green (its own tests pass) and is committed. The app will not fully compile until the route tasks land; that's expected and called out per task.

---

## Task 0: Confirm the starting state

**Files:** none (read-only sanity check).

- [ ] **Step 1: Confirm the working tree and that the spec is present**

Run:
```bash
git -C C:/Users/olive/QuestionBank status --short
```
Expected: shows the untracked spec files under `docs/superpowers/specs/` and this plan. **Do not commit** the unrelated fe-foundation plan, `packages/client/vitest.config.ts`, `packages/client/package.json`, or `.claude/settings.local.json` — those belong to a different session. Only stage server files + the two API spec/plan docs as you go.

- [ ] **Step 2: Confirm tests are green before changes**

Run:
```bash
npx vitest run packages/server
```
Expected: the existing chapter-based suite passes (PASS). This is the baseline you are about to rewrite.

---

## Task 1: Domain types — flat model

**Files:**
- Modify: `packages/server/src/domain/types.ts`

This is a pure type change. There is no dedicated type test; correctness is enforced by `npm run typecheck` and every downstream task. The app will not compile fully until routes are updated — that is expected. We still typecheck at the end to confirm the types themselves are self-consistent.

- [ ] **Step 1: Replace the contents of `domain/types.ts`**

Replace the **entire file** with:

```typescript
/** Raw backing for a question — the original image or text it came from. No image is persisted (TODO 3e). */
export interface QuestionSource {
  kind: 'image' | 'text';
  /** Plaintext input, if kind === 'text'. */
  rawText?: string;
}

export interface Book {
  id: string;
  /** Owning customer — every entity is scoped to one. */
  customerId: string;
  title: string;
  author?: string;
  /** Core feature, optional per-book. */
  learningGoal?: string;
  /** Enables cover resolution (client-side) + metadata re-lookup. */
  isbn?: string;
  publisher?: string;
  year?: number;
  /** Ordered ids of this book's problems — the array position IS the order AND membership. */
  questionIds: string[];
  createdAt: string;
}

export interface Question {
  id: string;
  /** Owning customer. */
  customerId: string;
  /** Owning book (re-rooted from chapterId). Order lives on the book, not here. */
  bookId: string;
  /** Required; defaults to the 1-based index, editable to a custom value like "1.A.3". */
  label: string;
  /** LaTeX/markdown — source of truth. */
  canonicalText: string;
  source: QuestionSource;
  createdAt: string;
}

/** Grade vocabulary. `partial` ⇒ the answer is ≥70% of the way there. */
export type Grade = 'correct' | 'partial' | 'incorrect';

/** Severity of one issue the grader found; the grade is derived from these. */
export type IssueSeverity = 'critical' | 'medium' | 'minor';

/** One problem the grader flagged with the student's answer. */
export interface GradingIssue {
  severity: IssueSeverity;
  description: string;
}

/** A committed grading attempt — final state only; the in-flight chat is not stored. */
export interface Attempt {
  id: string;
  /** Owning customer. */
  customerId: string;
  questionId: string;
  /** The user's answer as one block of inline-LaTeX text (photo-confirmed or typed). */
  answer: string;
  /** Grade derived from the final issue list. */
  recommendedGrade: Grade;
  /** User's final decision (accept or override). */
  rating: Grade;
  /** The issues the grader flagged on the final turn (empty ⇒ correct). */
  issues: GradingIssue[];
  createdAt: string;
}
```

What changed vs. the old file: `QuestionSource` drops `imagePath`; `Book` gains `isbn`/`publisher`/`year`/`questionIds`; `Chapter` and `Relevance` are **deleted**; `Question` drops `chapterId`/`relevance`/`nextReviewDate`/`skipped`/`snoozedUntil`, adds `bookId`, and `label` is now **required** (not optional); `Attempt` drops `imagePaths`/`answerText`/`transcription` and gains a single required `answer`.

- [ ] **Step 2: Typecheck the types in isolation**

Run:
```bash
npx tsc --noEmit -p packages/server/tsconfig.json
```
Expected: MANY errors, all in *other* files that still reference `chapterId`, `Chapter`, `imagePaths`, etc. There must be **zero** errors reported *inside `domain/types.ts` itself*. Skim the output to confirm no error points at `types.ts`. (The cascade of downstream errors is expected and gets fixed task-by-task.)

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/domain/types.ts
git commit -F .commitmsg
```
First write `.commitmsg` with:
```
feat(server)!: flat problems domain model

Book owns questionIds; Question re-roots to bookId with a required
label; Attempt collapses to a single answer field. Drop Chapter,
Relevance, and all persisted-image fields. Clean rewrite, no migration.
```
(Per user preference, multi-line commit messages go through `git commit -F <file>` to avoid PowerShell here-string mangling. Reuse/overwrite `.commitmsg` for each commit below.)

---

## Task 2: Store — drop the chapters collection

**Files:**
- Modify: `packages/server/src/storage/store.ts`
- Test: `packages/server/src/storage/store.test.ts` (already exists — adjust if it references chapters)

- [ ] **Step 1: Check the existing store test for chapter references**

Run:
```bash
npx vitest run packages/server/src/storage/store.test.ts
```
Read the test file. If it asserts a `chapters` collection, edit those assertions to remove chapters (the store now has `books`, `questions`, `attempts` only). If it doesn't mention chapters, leave it.

- [ ] **Step 2: Replace `store.ts` to drop chapters**

Replace the **entire file** with:

```typescript
import { join } from 'node:path';
import type { Attempt, Book, Question } from '../domain/types.js';
import { JsonCollection } from './json-collection.js';
import type { Repository } from './repository.js';

/** Owns the data directory and the per-entity collections. */
export class Store {
  private constructor(
    readonly books: Repository<Book>,
    readonly questions: Repository<Question>,
    readonly attempts: Repository<Attempt>,
  ) {}

  static async open(dataDir: string): Promise<Store> {
    const [books, questions, attempts] = await Promise.all([
      JsonCollection.open<Book>(join(dataDir, 'books.json')),
      JsonCollection.open<Question>(join(dataDir, 'questions.json')),
      JsonCollection.open<Attempt>(join(dataDir, 'attempts.json')),
    ]);
    return new Store(books, questions, attempts);
  }
}
```

- [ ] **Step 3: Run the store test**

Run:
```bash
npx vitest run packages/server/src/storage/store.test.ts
```
Expected: PASS. (`json-collection.test.ts` is unaffected — it tests the generic collection, not chapters.)

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/storage/store.ts packages/server/src/storage/store.test.ts
git commit -F .commitmsg
```
`.commitmsg`:
```
refactor(server): drop chapters collection from the store
```

---

## Task 3: Reconcile service (pure)

The render authority. Given a book's `questionIds` and the stored questions for that book, produce the healed ordered id list: keep existing ids in order, drop ids with no surviving question, append orphan questions (those whose `bookId` matches but are absent from the array). Orphans append in `createdAt` order so a half-written create surfaces deterministically last.

**Files:**
- Create: `packages/server/src/services/reconcile.ts`
- Test: `packages/server/src/services/reconcile.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/services/reconcile.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { Question } from '../domain/types.js';
import { reconcileQuestionIds } from './reconcile.js';

function q(id: string, createdAt: string): Question {
  return {
    id,
    customerId: 'local',
    bookId: 'b1',
    label: id,
    canonicalText: 'x',
    source: { kind: 'text', rawText: 'x' },
    createdAt,
  };
}

describe('reconcileQuestionIds', () => {
  it('keeps existing ids in their given order', () => {
    const questions = [q('a', '2026-01-01'), q('b', '2026-01-02')];
    expect(reconcileQuestionIds(['b', 'a'], questions)).toEqual(['b', 'a']);
  });

  it('drops ids that have no surviving question', () => {
    const questions = [q('a', '2026-01-01')];
    expect(reconcileQuestionIds(['a', 'ghost'], questions)).toEqual(['a']);
  });

  it('appends orphan questions (in createdAt order) after the kept ids', () => {
    const questions = [q('a', '2026-01-01'), q('c', '2026-01-03'), q('b', '2026-01-02')];
    // array only knows 'a'; b and c are orphans, appended oldest-first
    expect(reconcileQuestionIds(['a'], questions)).toEqual(['a', 'b', 'c']);
  });

  it('returns all questions when the array is empty', () => {
    const questions = [q('b', '2026-01-02'), q('a', '2026-01-01')];
    expect(reconcileQuestionIds([], questions)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run packages/server/src/services/reconcile.test.ts
```
Expected: FAIL — `Cannot find module './reconcile.js'` / `reconcileQuestionIds is not a function`.

- [ ] **Step 3: Write the implementation**

Create `packages/server/src/services/reconcile.ts`:

```typescript
import type { Question } from '../domain/types.js';

/**
 * Heal a book's ordered `questionIds` against the questions that actually exist for it.
 *
 * - ids present in `questionIds` AND backed by a surviving question are kept, in order;
 * - ids with no surviving question are dropped (a dangling create that never landed);
 * - questions for this book that are absent from `questionIds` are appended, oldest-first,
 *   so a half-written create surfaces last and never vanishes.
 *
 * Pure and total: the caller (the questions GET) persists the result back to the book.
 */
export function reconcileQuestionIds(questionIds: string[], questions: Question[]): string[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const kept = questionIds.filter((id) => byId.has(id));
  const keptSet = new Set(kept);
  const orphans = questions
    .filter((q) => !keptSet.has(q.id))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
    .map((q) => q.id);
  return [...kept, ...orphans];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run packages/server/src/services/reconcile.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/reconcile.ts packages/server/src/services/reconcile.test.ts
git commit -F .commitmsg
```
`.commitmsg`:
```
feat(server): reconcile questionIds against stored questions
```

---

## Task 4: Batch-save diff service (pure)

Given the full ordered incoming list (each item with-or-without an `id`), the stored questions for the book, the `bookId`, `customerId`, and id/time factories, compute the plan: which questions to **create**, **update**, **delete**, and the final `questionIds` order. Keeping this pure makes the atomic write in the route trivial and the diff fully testable without HTTP.

**Files:**
- Create: `packages/server/src/services/batch-save.ts`
- Test: `packages/server/src/services/batch-save.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/services/batch-save.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { Question } from '../domain/types.js';
import { planBatchSave, type IncomingQuestion } from './batch-save.js';

function stored(id: string, label: string, text: string): Question {
  return {
    id,
    customerId: 'local',
    bookId: 'b1',
    label,
    canonicalText: text,
    source: { kind: 'text', rawText: text },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

// Deterministic factories so the test asserts exact output.
let counter = 0;
const ids = () => `new-${++counter}`;
const now = () => '2026-06-10T00:00:00.000Z';

describe('planBatchSave', () => {
  it('creates items with no id, assigning ids and order from array position', () => {
    counter = 0;
    const incoming: IncomingQuestion[] = [
      { label: '1', canonicalText: 'a' },
      { label: '2', canonicalText: 'b' },
    ];
    const plan = planBatchSave({
      incoming,
      stored: [],
      bookId: 'b1',
      customerId: 'local',
      newId: ids,
      nowIso: now,
    });
    expect(plan.create.map((q) => q.canonicalText)).toEqual(['a', 'b']);
    expect(plan.create.map((q) => q.bookId)).toEqual(['b1', 'b1']);
    expect(plan.update).toEqual([]);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.questionIds).toEqual(['new-1', 'new-2']);
  });

  it('updates items that carry a known id (label + canonicalText only)', () => {
    counter = 0;
    const existing = stored('q1', 'old', 'old text');
    const plan = planBatchSave({
      incoming: [{ id: 'q1', label: 'new', canonicalText: 'new text' }],
      stored: [existing],
      bookId: 'b1',
      customerId: 'local',
      newId: ids,
      nowIso: now,
    });
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([{ id: 'q1', label: 'new', canonicalText: 'new text' }]);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.questionIds).toEqual(['q1']);
  });

  it('deletes stored questions whose id is absent from the incoming array', () => {
    counter = 0;
    const plan = planBatchSave({
      incoming: [{ id: 'keep', label: '1', canonicalText: 'k' }],
      stored: [stored('keep', '1', 'k'), stored('gone', '2', 'g')],
      bookId: 'b1',
      customerId: 'local',
      newId: ids,
      nowIso: now,
    });
    expect(plan.deleteIds).toEqual(['gone']);
    expect(plan.questionIds).toEqual(['keep']);
  });

  it('handles a mixed create/update/delete/reorder in one pass', () => {
    counter = 0;
    const plan = planBatchSave({
      incoming: [
        { id: 'b', label: '1', canonicalText: 'B' }, // update + moved first
        { label: '2', canonicalText: 'new' }, // create
        { id: 'a', label: '3', canonicalText: 'A' }, // update + moved last
      ],
      stored: [stored('a', 'x', 'A0'), stored('b', 'y', 'B0'), stored('c', 'z', 'C0')],
      bookId: 'b1',
      customerId: 'local',
      newId: ids,
      nowIso: now,
    });
    expect(plan.create.map((q) => q.id)).toEqual(['new-1']);
    expect(plan.update.map((u) => u.id).sort()).toEqual(['a', 'b']);
    expect(plan.deleteIds).toEqual(['c']);
    expect(plan.questionIds).toEqual(['b', 'new-1', 'a']);
  });

  it('ignores an incoming id that does not belong to this book (treated as create)', () => {
    counter = 0;
    const plan = planBatchSave({
      incoming: [{ id: 'foreign', label: '1', canonicalText: 'x' }],
      stored: [],
      bookId: 'b1',
      customerId: 'local',
      newId: ids,
      nowIso: now,
    });
    // Unknown id ⇒ cannot be an update; create a fresh row, do not honor the client id.
    expect(plan.create.map((q) => q.id)).toEqual(['new-1']);
    expect(plan.update).toEqual([]);
    expect(plan.questionIds).toEqual(['new-1']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run packages/server/src/services/batch-save.test.ts
```
Expected: FAIL — `Cannot find module './batch-save.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/server/src/services/batch-save.ts`:

```typescript
import type { Question } from '../domain/types.js';

/** One item in the incoming ordered list: an existing id to update, or no id to create. */
export interface IncomingQuestion {
  id?: string;
  label: string;
  canonicalText: string;
}

/** A field-limited update to an existing question (only label + text are client-editable). */
export interface QuestionUpdate {
  id: string;
  label: string;
  canonicalText: string;
}

/** The computed effect of a batch save, ready for the route to apply atomically. */
export interface BatchSavePlan {
  create: Question[];
  update: QuestionUpdate[];
  deleteIds: string[];
  /** Final ordered ids for book.questionIds — array position is the order. */
  questionIds: string[];
}

export interface PlanBatchSaveInput {
  incoming: IncomingQuestion[];
  /** Stored questions already owned by this book. */
  stored: Question[];
  bookId: string;
  customerId: string;
  newId: () => string;
  nowIso: () => string;
}

/**
 * Diff the full incoming ordered list against the book's stored questions:
 *   - item with an id matching a stored question for this book → update;
 *   - item with no id (or an unknown id) → create with a fresh id;
 *   - stored question whose id is absent from the incoming list → delete;
 *   - order = array position, captured into questionIds.
 *
 * Pure: the route turns this plan into one atomic sequence of store writes.
 */
export function planBatchSave(input: PlanBatchSaveInput): BatchSavePlan {
  const { incoming, stored, bookId, customerId, newId, nowIso } = input;
  const storedById = new Map(stored.map((q) => [q.id, q]));

  const create: Question[] = [];
  const update: QuestionUpdate[] = [];
  const questionIds: string[] = [];
  const survivingIds = new Set<string>();

  for (const item of incoming) {
    if (item.id !== undefined && storedById.has(item.id)) {
      update.push({ id: item.id, label: item.label, canonicalText: item.canonicalText });
      questionIds.push(item.id);
      survivingIds.add(item.id);
    } else {
      // No id, or an id we do not own → a new row; never honor a client-supplied unknown id.
      const id = newId();
      create.push({
        id,
        customerId,
        bookId,
        label: item.label,
        canonicalText: item.canonicalText,
        source: { kind: 'text', rawText: item.canonicalText },
        createdAt: nowIso(),
      });
      questionIds.push(id);
      survivingIds.add(id);
    }
  }

  const deleteIds = stored.filter((q) => !survivingIds.has(q.id)).map((q) => q.id);
  return { create, update, deleteIds, questionIds };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run packages/server/src/services/batch-save.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/batch-save.ts packages/server/src/services/batch-save.test.ts
git commit -F .commitmsg
```
`.commitmsg`:
```
feat(server): batch-save diff planner for the flat problem list
```

---

## Task 5: Books routes — metadata + book-level cascade delete

**Files:**
- Modify: `packages/server/src/routes/books.ts`
- Modify: `packages/server/src/services/cascade.ts` (slim it to book→questions→attempts; drop chapter cascade)
- Test: `packages/server/src/routes/books.test.ts` (rewrite — remove the `/tree` test, add metadata + cascade assertions)
- Test: `packages/server/src/services/cascade.test.ts` (rewrite for the book-level cascade)

- [ ] **Step 1: Rewrite the cascade service**

Replace the **entire** `packages/server/src/services/cascade.ts` with:

```typescript
import type { Store } from '../storage/store.js';

/**
 * Delete a book and everything under it — its questions and each question's attempts —
 * scoped to one customer. Chapters no longer exist; books own questions directly.
 */
export async function deleteBookCascade(
  store: Store,
  customerId: string,
  bookId: string,
): Promise<void> {
  const questions = (await store.questions.getAll(customerId)).filter((q) => q.bookId === bookId);
  const questionIds = new Set(questions.map((q) => q.id));
  for (const attempt of await store.attempts.getAll(customerId)) {
    if (questionIds.has(attempt.questionId)) {
      await store.attempts.delete(customerId, attempt.id);
    }
  }
  for (const q of questions) {
    await store.questions.delete(customerId, q.id);
  }
  await store.books.delete(customerId, bookId);
}
```

- [ ] **Step 2: Rewrite the cascade test**

Replace the **entire** `packages/server/src/services/cascade.test.ts` with:

```typescript
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, nowIso } from '../domain/ids.js';
import type { Attempt, Book, Question } from '../domain/types.js';
import { Store } from '../storage/store.js';
import { deleteBookCascade } from './cascade.js';

let dir: string;
let store: Store;
const CUST = 'local';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-cascade-'));
  store = await Store.open(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('deleteBookCascade', () => {
  it('removes the book, its questions, and their attempts; leaves other books intact', async () => {
    const book: Book = { id: newId(), customerId: CUST, title: 'B', questionIds: [], createdAt: nowIso() };
    const other: Book = { id: newId(), customerId: CUST, title: 'O', questionIds: [], createdAt: nowIso() };
    await store.books.create(CUST, book);
    await store.books.create(CUST, other);

    const q: Question = {
      id: newId(), customerId: CUST, bookId: book.id, label: '1',
      canonicalText: 'x', source: { kind: 'text', rawText: 'x' }, createdAt: nowIso(),
    };
    const otherQ: Question = {
      id: newId(), customerId: CUST, bookId: other.id, label: '1',
      canonicalText: 'y', source: { kind: 'text', rawText: 'y' }, createdAt: nowIso(),
    };
    await store.questions.create(CUST, q);
    await store.questions.create(CUST, otherQ);

    const attempt: Attempt = {
      id: newId(), customerId: CUST, questionId: q.id, answer: 'a',
      recommendedGrade: 'correct', rating: 'correct', issues: [], createdAt: nowIso(),
    };
    await store.attempts.create(CUST, attempt);

    await deleteBookCascade(store, CUST, book.id);

    expect(await store.books.getById(CUST, book.id)).toBeUndefined();
    expect(await store.books.getById(CUST, other.id)).toBeTruthy();
    expect((await store.questions.getAll(CUST)).map((x) => x.id)).toEqual([otherQ.id]);
    expect(await store.attempts.getAll(CUST)).toEqual([]);
  });
});
```

- [ ] **Step 3: Rewrite the books router**

Replace the **entire** `packages/server/src/routes/books.ts` with:

```typescript
import { Router } from 'express';
import { newId, nowIso } from '../domain/ids.js';
import type { Book } from '../domain/types.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import { deleteBookCascade } from '../services/cascade.js';
import type { Store } from '../storage/store.js';

/** Trim a string body field; returns undefined when not a non-empty string. */
function trimmed(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export function booksRouter(store: Store): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await store.books.getAll(requireCustomerId(req)));
  });

  router.post('/', async (req, res) => {
    const customerId = requireCustomerId(req);
    const { title, author, learningGoal, isbn, publisher, year } = req.body ?? {};
    if (typeof title !== 'string' || title.trim() === '') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const book: Book = {
      id: newId(),
      customerId,
      title: title.trim(),
      questionIds: [],
      createdAt: nowIso(),
      ...(trimmed(author) ? { author: trimmed(author) } : {}),
      ...(trimmed(learningGoal) ? { learningGoal: trimmed(learningGoal) } : {}),
      ...(trimmed(isbn) ? { isbn: trimmed(isbn) } : {}),
      ...(trimmed(publisher) ? { publisher: trimmed(publisher) } : {}),
      ...(typeof year === 'number' ? { year } : {}),
    };
    res.status(201).json(await store.books.create(customerId, book));
  });

  router.get('/:id', async (req, res) => {
    const book = await store.books.getById(requireCustomerId(req), req.params.id);
    if (!book) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(book);
  });

  router.patch('/:id', async (req, res) => {
    const customerId = requireCustomerId(req);
    if (!(await store.books.getById(customerId, req.params.id))) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const patch: Partial<Omit<Book, 'id' | 'customerId'>> = {};
    const { title, author, learningGoal, isbn, publisher, year } = req.body ?? {};
    if (typeof title === 'string') patch.title = title.trim();
    if (typeof author === 'string') patch.author = author.trim();
    if (typeof learningGoal === 'string') patch.learningGoal = learningGoal.trim();
    if (typeof isbn === 'string') patch.isbn = isbn.trim();
    if (typeof publisher === 'string') patch.publisher = publisher.trim();
    if (typeof year === 'number') patch.year = year;
    res.json(await store.books.update(customerId, req.params.id, patch));
  });

  router.delete('/:id', async (req, res) => {
    await deleteBookCascade(store, requireCustomerId(req), req.params.id);
    res.status(204).end();
  });

  return router;
}
```

> Note: the `/tree` route is gone. `questionIds` is initialized to `[]` on create. We intentionally do **not** let `PATCH /books/:id` set `questionIds` — the problem list is owned by `PUT /books/:bookId/questions` (Task 6), which is the single writer of that field.

- [ ] **Step 4: Rewrite the books route test**

Replace the **entire** `packages/server/src/routes/books.test.ts` with:

```typescript
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { FakeProvider } from '../llm/fake-provider.js';
import { Store } from '../storage/store.js';

let dir: string;
let app: Awaited<ReturnType<typeof createApp>>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-books-'));
  const store = await Store.open(dir);
  app = createApp(store, new FakeProvider(), undefined);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('books routes', () => {
  it('POST creates a book (questionIds empty) and GET lists it', async () => {
    const post = await request(app).post('/api/books').send({ title: 'Calculus' });
    expect(post.status).toEqual(201);
    expect(post.body).toMatchObject({ title: 'Calculus', questionIds: [] });
    expect(post.body.id).toBeTruthy();

    const list = await request(app).get('/api/books');
    expect(list.status).toEqual(200);
    expect(list.body).toHaveLength(1);
  });

  it('POST accepts metadata fields', async () => {
    const post = await request(app)
      .post('/api/books')
      .send({ title: 'Physics', isbn: '9780131118928', publisher: 'Pearson', year: 2004 });
    expect(post.status).toEqual(201);
    expect(post.body).toMatchObject({ isbn: '9780131118928', publisher: 'Pearson', year: 2004 });
  });

  it('POST rejects a missing title with 400', async () => {
    const res = await request(app).post('/api/books').send({ author: 'nobody' });
    expect(res.status).toEqual(400);
  });

  it('GET :id returns one book, 404 when unknown', async () => {
    const created = (await request(app).post('/api/books').send({ title: 'Physics' })).body;
    expect((await request(app).get(`/api/books/${created.id}`)).status).toEqual(200);
    expect((await request(app).get('/api/books/does-not-exist')).status).toEqual(404);
  });

  it('PATCH updates metadata fields', async () => {
    const created = (await request(app).post('/api/books').send({ title: 'Physics' })).body;
    const patched = await request(app)
      .patch(`/api/books/${created.id}`)
      .send({ author: 'Feynman', year: 1964 });
    expect(patched.status).toEqual(200);
    expect(patched.body).toMatchObject({ author: 'Feynman', year: 1964 });
  });

  it('DELETE cascades the book and its questions', async () => {
    const book = (await request(app).post('/api/books').send({ title: 'Physics' })).body;
    await request(app)
      .put(`/api/books/${book.id}/questions`)
      .send({ questions: [{ label: '1', canonicalText: 'x' }] });
    const del = await request(app).delete(`/api/books/${book.id}`);
    expect(del.status).toEqual(204);
    expect((await request(app).get('/api/books')).body).toHaveLength(0);
  });
});
```

> The DELETE test exercises `PUT …/questions`, which lands in Task 6. It will fail until then — that's fine; this task's gate (Step 5) runs the cascade unit test, which does not depend on the route. Re-run the full books test after Task 6.

- [ ] **Step 5: Run this task's tests**

Run:
```bash
npx vitest run packages/server/src/services/cascade.test.ts
```
Expected: PASS. (The books *route* test depends on Task 6's `index.ts` rewiring and the questions route; it is verified at the end of Task 6.)

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/books.ts packages/server/src/routes/books.test.ts packages/server/src/services/cascade.ts packages/server/src/services/cascade.test.ts
git commit -F .commitmsg
```
`.commitmsg`:
```
feat(server): book metadata fields + book-level cascade delete
```

---

## Task 6: Questions routes — reconciled GET + atomic batch PUT

This is the heart of the rewrite. Replace `routes/questions.ts` with two surfaces:
- `GET /api/books/:bookId/questions` — reconcile, persist the healed `questionIds` back to the book, return questions in that order.
- `PUT /api/books/:bookId/questions` — validate the body, plan via `planBatchSave`, apply create/update/delete, then write the new `questionIds` to the book. One logical atomic save.
- `GET /api/questions/:id` — one problem.

**Files:**
- Modify: `packages/server/src/routes/questions.ts` (full rewrite)
- Modify: `packages/server/src/index.ts` (rewire mounts)
- Test: `packages/server/src/routes/questions.test.ts` (full rewrite)

- [ ] **Step 1: Rewrite the questions router**

Replace the **entire** `packages/server/src/routes/questions.ts` with:

```typescript
import { Router } from 'express';
import { newId, nowIso } from '../domain/ids.js';
import type { Question } from '../domain/types.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import { planBatchSave, type IncomingQuestion } from '../services/batch-save.js';
import { reconcileQuestionIds } from '../services/reconcile.js';
import type { Store } from '../storage/store.js';

/** Order a book's questions by its (reconciled) questionIds; ids map 1:1 to questions. */
function orderByIds(ids: string[], questions: Question[]): Question[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  return ids.map((id) => byId.get(id)).filter((q): q is Question => q !== undefined);
}

/** Validate the PUT body into IncomingQuestion[]; returns undefined on any malformed item. */
function parseIncoming(raw: unknown): IncomingQuestion[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: IncomingQuestion[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return undefined;
    const { id, label, canonicalText } = item as Record<string, unknown>;
    if (typeof canonicalText !== 'string' || canonicalText.trim() === '') return undefined;
    if (typeof label !== 'string' || label.trim() === '') return undefined;
    if (id !== undefined && typeof id !== 'string') return undefined;
    out.push({
      label: label.trim(),
      canonicalText: canonicalText.trim(),
      ...(typeof id === 'string' ? { id } : {}),
    });
  }
  return out;
}

/** Nested under /api/books/:bookId/questions — reconciled list + atomic batch save. */
export function bookQuestionsRouter(store: Store): Router {
  const router = Router({ mergeParams: true });

  router.get('/', async (req, res) => {
    const customerId = requireCustomerId(req);
    const bookId = (req.params as { bookId: string }).bookId;
    const book = await store.books.getById(customerId, bookId);
    if (!book) {
      res.status(404).json({ error: 'book not found' });
      return;
    }
    const questions = (await store.questions.getAll(customerId)).filter((q) => q.bookId === bookId);
    const healed = reconcileQuestionIds(book.questionIds, questions);
    // Self-heal: persist the reconciled order back so the list converges on read.
    const same =
      healed.length === book.questionIds.length &&
      healed.every((id, i) => id === book.questionIds[i]);
    if (!same) {
      await store.books.update(customerId, bookId, { questionIds: healed });
    }
    res.json(orderByIds(healed, questions));
  });

  router.put('/', async (req, res) => {
    const customerId = requireCustomerId(req);
    const bookId = (req.params as { bookId: string }).bookId;
    if (!(await store.books.getById(customerId, bookId))) {
      res.status(404).json({ error: 'book not found' });
      return;
    }
    const incoming = parseIncoming((req.body ?? {}).questions);
    if (incoming === undefined) {
      res
        .status(400)
        .json({ error: 'questions must be an array of {label, canonicalText, id?}' });
      return;
    }
    const stored = (await store.questions.getAll(customerId)).filter((q) => q.bookId === bookId);
    const plan = planBatchSave({ incoming, stored, bookId, customerId, newId, nowIso });

    // Apply the diff, then commit the new order to the book. Single-writer store, so this
    // sequence is effectively atomic (no concurrent writer can interleave).
    for (const id of plan.deleteIds) await store.questions.delete(customerId, id);
    for (const q of plan.create) await store.questions.create(customerId, q);
    for (const u of plan.update) {
      await store.questions.update(customerId, u.id, {
        label: u.label,
        canonicalText: u.canonicalText,
      });
    }
    await store.books.update(customerId, bookId, { questionIds: plan.questionIds });

    const saved = (await store.questions.getAll(customerId)).filter((q) => q.bookId === bookId);
    res.json(orderByIds(plan.questionIds, saved));
  });

  return router;
}

/** Flat /api/questions/:id — single-problem read. */
export function questionsRouter(store: Store): Router {
  const router = Router();

  router.get('/:id', async (req, res) => {
    const question = await store.questions.getById(requireCustomerId(req), req.params.id);
    if (!question) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(question);
  });

  return router;
}
```

> When deleting a question we do **not** also delete its attempts here — batch save edits the live list; attempts for a deleted-by-omission problem are handled the same way the cascade does. **However**, to avoid orphan attempts, add attempt cleanup: see Step 1a.

- [ ] **Step 1a: Delete attempts for batch-deleted questions**

In the PUT handler, the delete loop must also drop each deleted question's attempts (mirroring the book cascade). Replace the delete loop:

```typescript
    for (const id of plan.deleteIds) await store.questions.delete(customerId, id);
```

with:

```typescript
    if (plan.deleteIds.length > 0) {
      const doomed = new Set(plan.deleteIds);
      for (const attempt of await store.attempts.getAll(customerId)) {
        if (doomed.has(attempt.questionId)) await store.attempts.delete(customerId, attempt.id);
      }
      for (const id of plan.deleteIds) await store.questions.delete(customerId, id);
    }
```

- [ ] **Step 2: Rewire `index.ts`**

Replace the **entire** `packages/server/src/index.ts` with:

```typescript
import express, { type Express } from 'express';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { booksRouter } from './routes/books.js';
import { bookQuestionsRouter, questionsRouter } from './routes/questions.js';
import { questionAttemptsRouter } from './routes/attempts.js';
import { questionTranscribeRouter } from './routes/transcribe.js';
import { questionGradeRouter } from './routes/grade.js';
import { lookupRouter } from './routes/lookup.js';
import { learnRouter } from './routes/learn.js';
import { practiceRouter } from './routes/practice.js';
import { AnthropicApiProvider } from './llm/anthropic-api-provider.js';
import type { LlmProvider } from './llm/provider.js';
import { errorLogger, requestLogger } from './logging/http.js';
import { log } from './logging/logger.js';
import {
  configFromEnv,
  resolveCustomer,
  type ResolveCustomerConfig,
} from './middleware/resolve-customer.js';
import { Store } from './storage/store.js';

const PORT = Number(process.env.PORT ?? 3001);
// Data lives in the user's home dir, not the repo, so it survives `git clean`, is never at
// risk of being committed, and is independent of the launch cwd. Override with QB_DATA_DIR.
const DATA_DIR = process.env.QB_DATA_DIR ?? join(homedir(), '.question-bank');

/** Build the Express app over a given store. Exported so tests can mount it without a port. */
export function createApp(
  store: Store,
  provider: LlmProvider,
  _unused?: unknown,
  customerConfig: ResolveCustomerConfig = configFromEnv(process.env),
): Express {
  const app = express();
  app.use(requestLogger);
  app.use(express.json());

  // Health is unauthenticated so a proxy/uptime check needs no identity.
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Every /api route below resolves the owning customer first.
  app.use('/api', resolveCustomer(customerConfig));

  app.use('/api/books', booksRouter(store));
  app.use('/api/books/:bookId/questions', bookQuestionsRouter(store));
  app.use('/api/questions/:id/attempts', questionAttemptsRouter(store));
  app.use('/api/questions/:id/transcribe', questionTranscribeRouter(store, provider));
  app.use('/api/questions/:id/grade', questionGradeRouter(store, provider));
  app.use('/api/lookup', lookupRouter());
  app.use('/api/learn', learnRouter(store));
  app.use('/api/practice', practiceRouter(store));
  app.use('/api/questions', questionsRouter(store));

  app.use(errorLogger);

  return app;
}

async function main(): Promise<void> {
  const store = await Store.open(DATA_DIR);
  const provider = new AnthropicApiProvider();
  const app = createApp(store, provider);
  const HOST = process.env.HOST ?? '0.0.0.0';
  app.listen(PORT, HOST, () => {
    log.info(`listening on http://${HOST}:${PORT}`);
    log.info(`data dir: ${DATA_DIR}`);
  });
}

// Only start a real server when this module is the process entry point.
const entry = argv[1];
if (entry !== undefined && fileURLToPath(import.meta.url) === entry) {
  void main();
}
```

> `createApp`'s 3rd param is kept as an ignored `_unused?: unknown` so the many existing tests that pass `new ImageStore(dir)` as the 3rd arg keep compiling during the transition. The transcribe/grade routers no longer take an `ImageStore`. The `lookupRouter` is added in Task 10; until then `index.ts` won't compile — that is expected and resolved when Task 10 lands. **Do the route work first, then Task 10, then run the full suite.** If you prefer a always-green path, implement Task 10 immediately after this step before running the full suite.

- [ ] **Step 3: Rewrite the questions route test**

Replace the **entire** `packages/server/src/routes/questions.test.ts` with:

```typescript
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { FakeProvider } from '../llm/fake-provider.js';
import { Store } from '../storage/store.js';

let dir: string;
let app: Awaited<ReturnType<typeof createApp>>;

async function makeBook(title = 'B'): Promise<string> {
  return (await request(app).post('/api/books').send({ title })).body.id;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-questions-'));
  const store = await Store.open(dir);
  app = createApp(store, new FakeProvider(), undefined);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('book questions routes', () => {
  it('PUT creates the initial list and GET returns it in order', async () => {
    const bookId = await makeBook();
    const put = await request(app)
      .put(`/api/books/${bookId}/questions`)
      .send({ questions: [{ label: '1', canonicalText: 'a' }, { label: '2', canonicalText: 'b' }] });
    expect(put.status).toEqual(200);
    expect(put.body.map((q: { canonicalText: string }) => q.canonicalText)).toEqual(['a', 'b']);

    const get = await request(app).get(`/api/books/${bookId}/questions`);
    expect(get.status).toEqual(200);
    expect(get.body.map((q: { canonicalText: string }) => q.canonicalText)).toEqual(['a', 'b']);
    // book.questionIds reflects the saved order
    const book = (await request(app).get(`/api/books/${bookId}`)).body;
    expect(book.questionIds).toEqual(get.body.map((q: { id: string }) => q.id));
  });

  it('PUT updates existing items and creates new ones in one batch', async () => {
    const bookId = await makeBook();
    const first = (
      await request(app)
        .put(`/api/books/${bookId}/questions`)
        .send({ questions: [{ label: '1', canonicalText: 'a' }] })
    ).body;
    const existingId = first[0].id;

    const second = await request(app)
      .put(`/api/books/${bookId}/questions`)
      .send({
        questions: [
          { id: existingId, label: '1', canonicalText: 'a-edited' },
          { label: '2', canonicalText: 'new' },
        ],
      });
    expect(second.status).toEqual(200);
    expect(second.body).toHaveLength(2);
    expect(second.body[0]).toMatchObject({ id: existingId, canonicalText: 'a-edited' });
    expect(second.body[1].canonicalText).toEqual('new');
  });

  it('PUT deletes items omitted from the array (and their attempts)', async () => {
    const bookId = await makeBook();
    const saved = (
      await request(app)
        .put(`/api/books/${bookId}/questions`)
        .send({ questions: [{ label: '1', canonicalText: 'keep' }, { label: '2', canonicalText: 'drop' }] })
    ).body;
    const keepId = saved[0].id;

    const after = await request(app)
      .put(`/api/books/${bookId}/questions`)
      .send({ questions: [{ id: keepId, label: '1', canonicalText: 'keep' }] });
    expect(after.body).toHaveLength(1);
    expect(after.body[0].id).toEqual(keepId);
  });

  it('PUT reorders by array position', async () => {
    const bookId = await makeBook();
    const saved = (
      await request(app)
        .put(`/api/books/${bookId}/questions`)
        .send({ questions: [{ label: '1', canonicalText: 'a' }, { label: '2', canonicalText: 'b' }] })
    ).body;
    const [a, b] = saved;
    const reordered = await request(app)
      .put(`/api/books/${bookId}/questions`)
      .send({ questions: [{ id: b.id, label: '2', canonicalText: 'b' }, { id: a.id, label: '1', canonicalText: 'a' }] });
    expect(reordered.body.map((q: { id: string }) => q.id)).toEqual([b.id, a.id]);
  });

  it('PUT rejects a malformed body with 400', async () => {
    const bookId = await makeBook();
    const res = await request(app)
      .put(`/api/books/${bookId}/questions`)
      .send({ questions: [{ canonicalText: '' }] });
    expect(res.status).toEqual(400);
  });

  it('GET/PUT on an unknown book is 404', async () => {
    expect((await request(app).get('/api/books/nope/questions')).status).toEqual(404);
    expect(
      (await request(app).put('/api/books/nope/questions').send({ questions: [] })).status,
    ).toEqual(404);
  });

  it('GET reconciles an orphan question into the list', async () => {
    // Save one question, then corrupt the book's questionIds to drop it; GET must re-append it.
    const store = await Store.open(dir);
    const bookId = await makeBook();
    const saved = (
      await request(app)
        .put(`/api/books/${bookId}/questions`)
        .send({ questions: [{ label: '1', canonicalText: 'orphan' }] })
    ).body;
    await store.books.update('local', bookId, { questionIds: [] });

    const get = await request(app).get(`/api/books/${bookId}/questions`);
    expect(get.body.map((q: { id: string }) => q.id)).toEqual([saved[0].id]);
  });

  it('GET /questions/:id returns one problem, 404 when unknown', async () => {
    const bookId = await makeBook();
    const saved = (
      await request(app)
        .put(`/api/books/${bookId}/questions`)
        .send({ questions: [{ label: '1', canonicalText: 'x' }] })
    ).body;
    expect((await request(app).get(`/api/questions/${saved[0].id}`)).status).toEqual(200);
    expect((await request(app).get('/api/questions/nope')).status).toEqual(404);
  });
});
```

> The reconcile test re-opens the same data dir with a second `Store.open(dir)`; since the in-memory collection is loaded from the file, writing through it and then issuing the HTTP GET (which uses the app's own store instance) would not see the change. **Adjust:** the app and the test must share one store. Use the store created in `beforeEach`. See Step 3a.

- [ ] **Step 3a: Share one store between the app and the reconcile test**

Change `beforeEach` to keep a reference to the store, and use it in the reconcile test instead of re-opening:

```typescript
let dir: string;
let store: Store;
let app: Awaited<ReturnType<typeof createApp>>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-questions-'));
  store = await Store.open(dir);
  app = createApp(store, new FakeProvider(), undefined);
});
```

And in the reconcile test, delete the `const store = await Store.open(dir);` line and use the shared `store` directly:

```typescript
  it('GET reconciles an orphan question into the list', async () => {
    const bookId = await makeBook();
    const saved = (
      await request(app)
        .put(`/api/books/${bookId}/questions`)
        .send({ questions: [{ label: '1', canonicalText: 'orphan' }] })
    ).body;
    await store.books.update('local', bookId, { questionIds: [] });

    const get = await request(app).get(`/api/books/${bookId}/questions`);
    expect(get.body.map((q: { id: string }) => q.id)).toEqual([saved[0].id]);
  });
```

- [ ] **Step 4: Run questions + books route tests**

(Requires Task 10's `lookup.ts` to exist for `index.ts` to compile. If you have not done Task 10 yet, do it now, then return here.)

Run:
```bash
npx vitest run packages/server/src/routes/questions.test.ts packages/server/src/routes/books.test.ts
```
Expected: PASS (all questions + books cases).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/questions.ts packages/server/src/routes/questions.test.ts packages/server/src/index.ts
git commit -F .commitmsg
```
`.commitmsg`:
```
feat(server): reconciled GET + atomic batch PUT for the problem list

Book-rooted /books/:bookId/questions replaces the per-chapter and
per-item routes. PUT diffs the full ordered list (create/update/delete),
sets order from array position, and cascades attempts for removed items.
```

---

## Task 7: Attempts route — single answer field

**Files:**
- Modify: `packages/server/src/routes/attempts.ts`
- Test: `packages/server/src/routes/attempts.test.ts` (rewrite the body shape)

- [ ] **Step 1: Rewrite the attempts router**

Replace the **entire** `packages/server/src/routes/attempts.ts` with:

```typescript
import { Router } from 'express';
import { newId, nowIso } from '../domain/ids.js';
import type { Attempt, Grade, GradingIssue, IssueSeverity } from '../domain/types.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import type { Store } from '../storage/store.js';

const GRADES: readonly Grade[] = ['correct', 'partial', 'incorrect'];
const SEVERITIES: readonly IssueSeverity[] = ['critical', 'medium', 'minor'];

function isGrade(value: unknown): value is Grade {
  return typeof value === 'string' && (GRADES as readonly string[]).includes(value);
}

/** Validate the issues field into GradingIssue[] (defaults to [] when absent). */
function parseIssues(raw: unknown): GradingIssue[] | undefined {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return undefined;
  const out: GradingIssue[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return undefined;
    const { severity, description } = item as Record<string, unknown>;
    if (typeof severity !== 'string' || !(SEVERITIES as readonly string[]).includes(severity)) {
      return undefined;
    }
    if (typeof description !== 'string') return undefined;
    out.push({ severity: severity as IssueSeverity, description });
  }
  return out;
}

/** Nested under /api/questions/:id/attempts — list + create (final-state only). */
export function questionAttemptsRouter(store: Store): Router {
  const router = Router({ mergeParams: true });

  router.get('/', async (req, res) => {
    const customerId = requireCustomerId(req);
    const questionId = (req.params as { id: string }).id;
    if (!(await store.questions.getById(customerId, questionId))) {
      res.status(404).json({ error: 'question not found' });
      return;
    }
    res.json((await store.attempts.getAll(customerId)).filter((a) => a.questionId === questionId));
  });

  router.post('/', async (req, res) => {
    const customerId = requireCustomerId(req);
    const questionId = (req.params as { id: string }).id;
    if (!(await store.questions.getById(customerId, questionId))) {
      res.status(404).json({ error: 'question not found' });
      return;
    }
    const { answer, recommendedGrade, rating, issues } = req.body ?? {};

    if (typeof answer !== 'string' || answer.trim() === '') {
      res.status(400).json({ error: 'answer is required' });
      return;
    }
    if (!isGrade(recommendedGrade) || !isGrade(rating)) {
      res.status(400).json({ error: 'recommendedGrade and rating must be valid grades' });
      return;
    }
    const parsedIssues = parseIssues(issues);
    if (parsedIssues === undefined) {
      res.status(400).json({ error: 'issues must be an array of {severity, description}' });
      return;
    }
    const attempt: Attempt = {
      id: newId(),
      customerId,
      questionId,
      answer: answer.trim(),
      recommendedGrade,
      rating,
      issues: parsedIssues,
      createdAt: nowIso(),
    };
    res.status(201).json(await store.attempts.create(customerId, attempt));
  });

  return router;
}
```

- [ ] **Step 2: Rewrite the attempts route test**

Replace the **entire** `packages/server/src/routes/attempts.test.ts` with:

```typescript
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { FakeProvider } from '../llm/fake-provider.js';
import { Store } from '../storage/store.js';

let dir: string;
let app: Awaited<ReturnType<typeof createApp>>;

async function makeQuestion(): Promise<string> {
  const bookId = (await request(app).post('/api/books').send({ title: 'B' })).body.id;
  const saved = (
    await request(app)
      .put(`/api/books/${bookId}/questions`)
      .send({ questions: [{ label: '1', canonicalText: 'x' }] })
  ).body;
  return saved[0].id;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-attempts-'));
  const store = await Store.open(dir);
  app = createApp(store, new FakeProvider(), undefined);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('attempts routes', () => {
  it('POST saves an attempt with a single answer field', async () => {
    const qid = await makeQuestion();
    const res = await request(app)
      .post(`/api/questions/${qid}/attempts`)
      .send({ answer: 'x = 4', recommendedGrade: 'correct', rating: 'correct', issues: [] });
    expect(res.status).toEqual(201);
    expect(res.body).toMatchObject({ answer: 'x = 4', rating: 'correct' });

    const list = await request(app).get(`/api/questions/${qid}/attempts`);
    expect(list.body).toHaveLength(1);
  });

  it('POST rejects a blank answer with 400', async () => {
    const qid = await makeQuestion();
    const res = await request(app)
      .post(`/api/questions/${qid}/attempts`)
      .send({ answer: '   ', recommendedGrade: 'correct', rating: 'correct' });
    expect(res.status).toEqual(400);
  });

  it('POST rejects an invalid grade with 400', async () => {
    const qid = await makeQuestion();
    const res = await request(app)
      .post(`/api/questions/${qid}/attempts`)
      .send({ answer: 'x', recommendedGrade: 'great', rating: 'correct' });
    expect(res.status).toEqual(400);
  });

  it('POST on an unknown question is 404', async () => {
    const res = await request(app)
      .post('/api/questions/nope/attempts')
      .send({ answer: 'x', recommendedGrade: 'correct', rating: 'correct' });
    expect(res.status).toEqual(404);
  });
});
```

- [ ] **Step 3: Run the attempts test**

Run:
```bash
npx vitest run packages/server/src/routes/attempts.test.ts
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/attempts.ts packages/server/src/routes/attempts.test.ts
git commit -F .commitmsg
```
`.commitmsg`:
```
feat(server): attempts carry a single answer field, no image paths
```

---

## Task 8: Transcribe + grade routes — read-only, transient images, no chapter context

`transcribe` takes image bytes, returns the transcription text, persists nothing (no `ImageStore`, no saved paths, no `/retry` against disk). `grade` drops the chapter lookup from its context.

**Files:**
- Modify: `packages/server/src/routes/transcribe.ts` (full rewrite — no ImageStore, no disk)
- Modify: `packages/server/src/routes/grade.ts` (drop chapter context)
- Test: `packages/server/src/routes/grade.test.ts` (adjust setup for new question shape)
- Test: there is no `transcribe.test.ts` currently; add one.

- [ ] **Step 1: Rewrite the transcribe router**

Replace the **entire** `packages/server/src/routes/transcribe.ts` with:

```typescript
import { Router } from 'express';
import multer from 'multer';
import { bufferImage, type ImageMimeType } from '../llm/image-ref.js';
import { LlmError, type LlmProvider, type Message } from '../llm/provider.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import { log } from '../logging/logger.js';
import {
  buildRetranscriptionPrompt,
  buildTranscriptionPrompt,
  transcriptionSchema,
} from '../llm/transcription-contract.js';
import type { Store } from '../storage/store.js';

const IMAGE_EXTS: Record<string, ImageMimeType> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
};

function isImage(mimetype: string): mimetype is ImageMimeType {
  return mimetype in IMAGE_EXTS;
}

/**
 * Nested under /api/questions/:id/transcribe — read-only: answer image bytes in, inline-LaTeX
 * transcription out. Persists NOTHING (TODO 3e): images flow transiently to the provider and are
 * never written to disk. Retranscribe re-accepts the bytes plus a correction note.
 */
export function questionTranscribeRouter(store: Store, provider: LlmProvider): Router {
  const router = Router({ mergeParams: true });
  const upload = multer({ storage: multer.memoryStorage() });

  router.post('/', upload.array('images'), async (req, res) => {
    const customerId = requireCustomerId(req);
    const questionId = (req.params as { id: string }).id;
    const question = await store.questions.getById(customerId, questionId);
    if (!question) {
      res.status(404).json({ error: 'question not found' });
      return;
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: 'at least one image is required' });
      return;
    }
    for (const file of files) {
      if (!isImage(file.mimetype)) {
        res.status(400).json({ error: 'uploads must be images (png, jpeg, webp, gif)' });
        return;
      }
    }

    const images = files.map((f) => bufferImage(f.buffer, f.mimetype as ImageMimeType));
    log.info('transcribing answer', { question: questionId, images: files.length });

    const message: Message = {
      role: 'user',
      text: buildTranscriptionPrompt(question.canonicalText),
      images,
    };
    try {
      const out = await provider.completeStructured<{ transcription: string }>(
        [message],
        transcriptionSchema,
      );
      res.json({ transcription: out.transcription });
    } catch (err) {
      if (err instanceof LlmError) {
        log.warn('transcription failed', { question: questionId });
        res.status(502).json({ error: 'transcription failed' });
        return;
      }
      throw err;
    }
  });

  // Retranscribe: re-uploaded image bytes + the current transcription + a correction note.
  // Still read-only; nothing is persisted, so the client must re-send the images.
  router.post('/retry', upload.array('images'), async (req, res) => {
    const customerId = requireCustomerId(req);
    const questionId = (req.params as { id: string }).id;
    const question = await store.questions.getById(customerId, questionId);
    if (!question) {
      res.status(404).json({ error: 'question not found' });
      return;
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: 'at least one image is required' });
      return;
    }
    for (const file of files) {
      if (!isImage(file.mimetype)) {
        res.status(400).json({ error: 'uploads must be images (png, jpeg, webp, gif)' });
        return;
      }
    }
    const { currentTranscription, correctionNote } = req.body ?? {};
    if (typeof currentTranscription !== 'string' || typeof correctionNote !== 'string') {
      res
        .status(400)
        .json({ error: 'currentTranscription and correctionNote are required strings' });
      return;
    }

    const images = files.map((f) => bufferImage(f.buffer, f.mimetype as ImageMimeType));
    log.info('retranscribing answer', { question: questionId, images: files.length });

    const message: Message = {
      role: 'user',
      text: buildRetranscriptionPrompt(question.canonicalText, currentTranscription, correctionNote),
      images,
    };
    try {
      const out = await provider.completeStructured<{ transcription: string }>(
        [message],
        transcriptionSchema,
      );
      res.json({ transcription: out.transcription });
    } catch (err) {
      if (err instanceof LlmError) {
        log.warn('retranscription failed', { question: questionId });
        res.status(502).json({ error: 'transcription failed' });
        return;
      }
      throw err;
    }
  });

  return router;
}
```

> Confirm `buildRetranscriptionPrompt`, `buildTranscriptionPrompt`, and `transcriptionSchema` are exported by `llm/transcription-contract.ts` (they are, per the old transcribe route). `bufferImage` and `ImageMimeType` come from `llm/image-ref.js`; `fileImage` is no longer used here.

- [ ] **Step 2: Rewrite the grade router (drop chapter context)**

In `packages/server/src/routes/grade.ts`, replace the context-building block. Find:

```typescript
    const chapter = await store.chapters.getById(customerId, question.chapterId);
    const book = chapter ? await store.books.getById(customerId, chapter.bookId) : undefined;
    const ctx: GradingContext = {
      canonicalText: question.canonicalText,
      ...(chapter?.description !== undefined ? { chapterDescription: chapter.description } : {}),
      ...(book?.learningGoal !== undefined ? { bookLearningGoal: book.learningGoal } : {}),
    };
```

Replace with:

```typescript
    const book = await store.books.getById(customerId, question.bookId);
    const ctx: GradingContext = {
      canonicalText: question.canonicalText,
      ...(book?.learningGoal !== undefined ? { bookLearningGoal: book.learningGoal } : {}),
    };
```

`GradingContext.chapterDescription` stays defined in the contract (harmless, unused now); we simply never set it. No other change to `grade.ts`.

- [ ] **Step 3: Add a transcribe route test**

Create `packages/server/src/routes/transcribe.test.ts`:

```typescript
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { FakeProvider } from '../llm/fake-provider.js';
import { LlmError } from '../llm/provider.js';
import { Store } from '../storage/store.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex'); // minimal PNG signature bytes

let dir: string;
let provider: FakeProvider;
let app: Awaited<ReturnType<typeof createApp>>;

async function makeQuestion(): Promise<string> {
  const bookId = (await request(app).post('/api/books').send({ title: 'B' })).body.id;
  const saved = (
    await request(app)
      .put(`/api/books/${bookId}/questions`)
      .send({ questions: [{ label: '1', canonicalText: 'x' }] })
  ).body;
  return saved[0].id;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-transcribe-'));
  const store = await Store.open(dir);
  provider = new FakeProvider({ structured: { transcription: 'x = 4' } });
  app = createApp(store, provider, undefined);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('transcribe route', () => {
  it('returns a transcription and persists nothing', async () => {
    const qid = await makeQuestion();
    const res = await request(app)
      .post(`/api/questions/${qid}/transcribe`)
      .attach('images', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toEqual(200);
    expect(res.body).toEqual({ transcription: 'x = 4' });
    // No imagePaths in the response — nothing was saved.
    expect(res.body.imagePaths).toBeUndefined();
  });

  it('400 when no image is attached', async () => {
    const qid = await makeQuestion();
    const res = await request(app).post(`/api/questions/${qid}/transcribe`).send();
    expect(res.status).toEqual(400);
  });

  it('502 on provider failure', async () => {
    const qid = await makeQuestion();
    provider.failWith(new LlmError('boom'));
    const res = await request(app)
      .post(`/api/questions/${qid}/transcribe`)
      .attach('images', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toEqual(502);
  });
});
```

- [ ] **Step 4: Fix the grade test setup**

Open `packages/server/src/routes/grade.test.ts`. It currently builds a question via the chapter route. Replace its question-creation helper so it uses the new book→questions flow, and drop `ImageStore` from `createApp`. Concretely:

- In `beforeEach`, change `app = createApp(store, provider, new ImageStore(dir));` to `app = createApp(store, provider, undefined);` and remove the now-unused `ImageStore` import.
- Wherever the test creates a question through `/api/books/:id/chapters` + `/api/chapters/:id/questions`, replace with:

```typescript
  const bookId = (await request(app).post('/api/books').send({ title: 'B' })).body.id;
  const qid = (
    await request(app)
      .put(`/api/books/${bookId}/questions`)
      .send({ questions: [{ label: '1', canonicalText: 'Solve x+2=6' }] })
  ).body[0].id;
```

Keep every grading assertion (the FakeProvider's structured output and 502 paths) unchanged.

- [ ] **Step 5: Run the transcribe + grade tests**

Run:
```bash
npx vitest run packages/server/src/routes/transcribe.test.ts packages/server/src/routes/grade.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/transcribe.ts packages/server/src/routes/transcribe.test.ts packages/server/src/routes/grade.ts packages/server/src/routes/grade.test.ts
git commit -F .commitmsg
```
`.commitmsg`:
```
feat(server): read-only transcribe/grade with transient images

Transcribe takes image bytes and returns text, persisting nothing.
Grade drops chapter context and reads the book directly.
```

---

## Task 9: Learn + practice queues — order by questionIds, drop skip/chapter

`learn/next` orders by book sequence then by each book's `questionIds` position. `practice/due` drops the `skipped` filter and the chapter lookup. Both drop `Chapter` imports.

**Files:**
- Modify: `packages/server/src/services/learn-next.ts`
- Modify: `packages/server/src/services/due-queue.ts`
- Modify: `packages/server/src/routes/practice.ts` (add `?count=true` support per spec)
- Test: `packages/server/src/routes/practice.test.ts` (adjust question setup)
- Note: `learn-next` and `due-queue` have no standalone unit tests currently; behavior is covered through the route tests (`practice.test.ts`) and a new learn assertion. Add a learn route test.

- [ ] **Step 1: Rewrite `learn-next.ts`**

Replace the **entire** `packages/server/src/services/learn-next.ts` with:

```typescript
import type { Book, Question } from '../domain/types.js';
import type { Store } from '../storage/store.js';

export interface LearnNext {
  question: Question;
  book: Book;
}

/**
 * The next question to suggest: the first un-attempted question, scanning books in list
 * order and, within each book, in `questionIds` order. `now` is accepted for signature
 * symmetry with the other queues; it is not currently used (skip/snooze are gone — Skip is
 * client-only). Returns undefined when nothing is eligible.
 */
export async function suggestNext(
  store: Store,
  customerId: string,
  _now: string,
): Promise<LearnNext | undefined> {
  const attempted = new Set((await store.attempts.getAll(customerId)).map((a) => a.questionId));
  const books = await store.books.getAll(customerId);
  const questionById = new Map(
    (await store.questions.getAll(customerId)).map((q) => [q.id, q]),
  );

  for (const book of books) {
    for (const id of book.questionIds) {
      const question = questionById.get(id);
      if (question === undefined) continue; // dangling id — reconcile heals it on read
      if (attempted.has(id)) continue;
      return { question, book };
    }
  }
  return undefined;
}
```

- [ ] **Step 2: Rewrite `due-queue.ts`**

Replace the **entire** `packages/server/src/services/due-queue.ts` with:

```typescript
import type { Book, Question } from '../domain/types.js';
import { scheduleFor, type ReviewSchedule } from './srs.js';
import type { Store } from '../storage/store.js';

/** One due review: the question with its book context and derived schedule. */
export interface DueItem {
  question: Question;
  book: Book;
  schedule: ReviewSchedule;
}

/**
 * The questions due for review now: those with at least one attempt whose derived
 * nextReviewDate is at or before `now`, ordered by nextReviewDate ascending (most overdue
 * first). Schedule is computed on read from attempt history. Skip is client-only now, so
 * there is no skipped filter.
 */
export async function dueQueue(store: Store, customerId: string, now: string): Promise<DueItem[]> {
  const attempts = await store.attempts.getAll(customerId);
  const byQuestion = new Map<string, typeof attempts>();
  for (const a of attempts) {
    const list = byQuestion.get(a.questionId);
    if (list) list.push(a);
    else byQuestion.set(a.questionId, [a]);
  }

  const bookById = new Map((await store.books.getAll(customerId)).map((b) => [b.id, b]));

  const items: DueItem[] = [];
  for (const question of await store.questions.getAll(customerId)) {
    const qAttempts = byQuestion.get(question.id);
    if (qAttempts === undefined) continue; // never attempted → not in the ladder
    const schedule = scheduleFor(qAttempts, now);
    if (schedule === null) continue;
    if (schedule.nextReviewDate > now) continue; // not due yet
    const book = bookById.get(question.bookId);
    if (book === undefined) continue;
    items.push({ question, book, schedule });
  }

  items.sort((a, b) =>
    a.schedule.nextReviewDate < b.schedule.nextReviewDate
      ? -1
      : a.schedule.nextReviewDate > b.schedule.nextReviewDate
        ? 1
        : 0,
  );
  return items;
}
```

- [ ] **Step 3: Add `?count=true` to the practice route**

Replace the **entire** `packages/server/src/routes/practice.ts` with:

```typescript
import { Router } from 'express';
import { nowIso } from '../domain/ids.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import { dueQueue } from '../services/due-queue.js';
import type { Store } from '../storage/store.js';

/** /api/practice — read-only spaced-repetition queue endpoints. */
export function practiceRouter(store: Store): Router {
  const router = Router();
  router.get('/due', async (req, res) => {
    const items = await dueQueue(store, requireCustomerId(req), nowIso());
    // index.html's revisit banner wants just the number; ?count=true returns it.
    if (req.query.count === 'true') {
      res.json({ count: items.length });
      return;
    }
    res.json(items);
  });
  return router;
}
```

- [ ] **Step 4: Fix the practice test**

Open `packages/server/src/routes/practice.test.ts`. Replace any chapter-based question creation with the book→questions flow (same helper as Task 8 Step 4), drop `ImageStore` from `createApp` (pass `undefined`), and add one assertion for the count form:

```typescript
  it('GET /due?count=true returns just the count', async () => {
    const res = await request(app).get('/api/practice/due?count=true');
    expect(res.status).toEqual(200);
    expect(res.body).toEqual({ count: 0 });
  });
```

Keep the existing due-ordering assertions; they only need the question setup updated to the new flow and `book`-not-`chapter` context in any response shape they assert (the response items now have `book` but no `chapter`).

- [ ] **Step 5: Add a learn route test**

Create `packages/server/src/routes/learn.test.ts`:

```typescript
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { FakeProvider } from '../llm/fake-provider.js';
import { Store } from '../storage/store.js';

let dir: string;
let app: Awaited<ReturnType<typeof createApp>>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-learn-'));
  const store = await Store.open(dir);
  app = createApp(store, new FakeProvider(), undefined);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('learn route', () => {
  it('suggests the first un-attempted question in questionIds order', async () => {
    const bookId = (await request(app).post('/api/books').send({ title: 'B' })).body.id;
    const saved = (
      await request(app)
        .put(`/api/books/${bookId}/questions`)
        .send({ questions: [{ label: '1', canonicalText: 'a' }, { label: '2', canonicalText: 'b' }] })
    ).body;

    const next = await request(app).get('/api/learn/next');
    expect(next.status).toEqual(200);
    expect(next.body.question.id).toEqual(saved[0].id);
    expect(next.body.book.id).toEqual(bookId);
  });

  it('returns {question: null} when nothing is eligible', async () => {
    const next = await request(app).get('/api/learn/next');
    expect(next.status).toEqual(200);
    expect(next.body).toEqual({ question: null });
  });
});
```

- [ ] **Step 6: Run learn + practice tests**

Run:
```bash
npx vitest run packages/server/src/routes/learn.test.ts packages/server/src/routes/practice.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/learn-next.ts packages/server/src/services/due-queue.ts packages/server/src/routes/practice.ts packages/server/src/routes/practice.test.ts packages/server/src/routes/learn.test.ts
git commit -F .commitmsg
```
`.commitmsg`:
```
feat(server): queues order by questionIds; drop skip + chapter context

Learn-next scans books then questionIds; due-queue drops the skipped
filter; practice/due supports ?count=true for the revisit banner.
```

---

## Task 10: ISBN lookup endpoint

A read-only, network-dependent endpoint: `GET /api/lookup/isbn/:isbn` → `{ title, author?, publisher?, year? }`. The network fetch is injected so the route is testable without hitting the network. Default implementation calls Open Library.

**Files:**
- Create: `packages/server/src/services/isbn-lookup.ts`
- Create: `packages/server/src/services/isbn-lookup.test.ts`
- Create: `packages/server/src/routes/lookup.ts`
- Create: `packages/server/src/routes/lookup.test.ts`

- [ ] **Step 1: Write the failing service test**

Create `packages/server/src/services/isbn-lookup.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { parseOpenLibrary } from './isbn-lookup.js';

describe('parseOpenLibrary', () => {
  it('maps an Open Library record to book metadata', () => {
    const raw = {
      title: 'Introduction to Electrodynamics',
      authors: [{ name: 'David J. Griffiths' }],
      publishers: [{ name: 'Pearson' }],
      publish_date: '2012',
    };
    expect(parseOpenLibrary(raw)).toEqual({
      title: 'Introduction to Electrodynamics',
      author: 'David J. Griffiths',
      publisher: 'Pearson',
      year: 2012,
    });
  });

  it('returns undefined when there is no title', () => {
    expect(parseOpenLibrary({ authors: [{ name: 'X' }] })).toBeUndefined();
  });

  it('extracts a 4-digit year from a messy publish_date', () => {
    const raw = { title: 'T', publish_date: 'March 15, 1999' };
    expect(parseOpenLibrary(raw)?.year).toEqual(1999);
  });

  it('omits optional fields that are absent', () => {
    expect(parseOpenLibrary({ title: 'Only Title' })).toEqual({ title: 'Only Title' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
npx vitest run packages/server/src/services/isbn-lookup.test.ts
```
Expected: FAIL — `Cannot find module './isbn-lookup.js'`.

- [ ] **Step 3: Write the service**

Create `packages/server/src/services/isbn-lookup.ts`:

```typescript
/** Book metadata resolved from an external catalog. Title is the only guaranteed field. */
export interface BookMetadata {
  title: string;
  author?: string;
  publisher?: string;
  year?: number;
}

/** Function that fetches the raw catalog record for an ISBN (injected for testability). */
export type IsbnFetcher = (isbn: string) => Promise<unknown>;

/** Pull the first 4-digit run out of a free-form publish date, if any. */
function extractYear(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = value.match(/\d{4}/);
  return match ? Number(match[0]) : undefined;
}

/** Map an Open Library "books" record to BookMetadata; undefined when it has no title. */
export function parseOpenLibrary(raw: unknown): BookMetadata | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.title !== 'string' || obj.title.trim() === '') return undefined;

  const authors = Array.isArray(obj.authors) ? obj.authors : [];
  const firstAuthor = authors[0];
  const author =
    typeof firstAuthor === 'object' && firstAuthor !== null
      ? (firstAuthor as Record<string, unknown>).name
      : undefined;

  const publishers = Array.isArray(obj.publishers) ? obj.publishers : [];
  const firstPublisher = publishers[0];
  const publisher =
    typeof firstPublisher === 'object' && firstPublisher !== null
      ? (firstPublisher as Record<string, unknown>).name
      : undefined;

  const year = extractYear(obj.publish_date);

  return {
    title: obj.title,
    ...(typeof author === 'string' ? { author } : {}),
    ...(typeof publisher === 'string' ? { publisher } : {}),
    ...(year !== undefined ? { year } : {}),
  };
}

/** Default fetcher: Open Library's jscmd=data endpoint, which returns one record per ISBN. */
export const openLibraryFetcher: IsbnFetcher = async (isbn: string): Promise<unknown> => {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(
    isbn,
  )}&format=json&jscmd=data`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`open library ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  return body[`ISBN:${isbn}`];
};

/** Resolve metadata for an ISBN via the given fetcher; undefined when not found. */
export async function lookupIsbn(
  isbn: string,
  fetcher: IsbnFetcher = openLibraryFetcher,
): Promise<BookMetadata | undefined> {
  const raw = await fetcher(isbn);
  return parseOpenLibrary(raw);
}
```

- [ ] **Step 4: Run the service test**

Run:
```bash
npx vitest run packages/server/src/services/isbn-lookup.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Write the lookup route + test**

Create `packages/server/src/routes/lookup.ts`:

```typescript
import { Router } from 'express';
import { lookupIsbn, type IsbnFetcher } from '../services/isbn-lookup.js';

/**
 * /api/lookup — read-only external-catalog reads (not CRUD). The fetcher is injectable so
 * tests run offline; production uses the default Open Library fetcher.
 */
export function lookupRouter(fetcher?: IsbnFetcher): Router {
  const router = Router();

  router.get('/isbn/:isbn', async (req, res) => {
    let metadata;
    try {
      metadata = await lookupIsbn(req.params.isbn, fetcher);
    } catch {
      res.status(502).json({ error: 'lookup failed' });
      return;
    }
    if (!metadata) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(metadata);
  });

  return router;
}
```

Create `packages/server/src/routes/lookup.test.ts`:

```typescript
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { lookupRouter } from './lookup.js';

function appWith(fetcher: (isbn: string) => Promise<unknown>) {
  const app = express();
  app.use(express.json());
  app.use('/api/lookup', lookupRouter(fetcher));
  return app;
}

describe('lookup route', () => {
  it('returns mapped metadata for a known ISBN', async () => {
    const app = appWith(async () => ({
      title: 'Electrodynamics',
      authors: [{ name: 'Griffiths' }],
      publish_date: '2012',
    }));
    const res = await request(app).get('/api/lookup/isbn/9780131118928');
    expect(res.status).toEqual(200);
    expect(res.body).toMatchObject({ title: 'Electrodynamics', author: 'Griffiths', year: 2012 });
  });

  it('404 when the catalog has no record', async () => {
    const app = appWith(async () => undefined);
    const res = await request(app).get('/api/lookup/isbn/0000000000');
    expect(res.status).toEqual(404);
  });

  it('502 when the catalog call throws', async () => {
    const app = appWith(async () => {
      throw new Error('network down');
    });
    const res = await request(app).get('/api/lookup/isbn/9780131118928');
    expect(res.status).toEqual(502);
  });
});
```

> The route test mounts `lookupRouter` directly (no customer middleware) since lookup is catalog-only; the production mount in `index.ts` still sits behind `resolveCustomer`, which is correct (a lookup is per-customer-authenticated even though the data isn't customer-scoped).

- [ ] **Step 6: Run the lookup route test**

Run:
```bash
npx vitest run packages/server/src/routes/lookup.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/isbn-lookup.ts packages/server/src/services/isbn-lookup.test.ts packages/server/src/routes/lookup.ts packages/server/src/routes/lookup.test.ts
git commit -F .commitmsg
```
`.commitmsg`:
```
feat(server): read-only ISBN metadata lookup endpoint
```

---

## Task 11: Remove the dead chapter + image files

Now that nothing references them, delete the chapter routes, tree service, image store, and their tests. Update the extract path (the chapter-questions `extract` route lived in `questions.ts`, already removed in Task 6) — but the `extract.ts` LLM helper and its `bufferImage` usage stay; what goes is image *persistence*.

**Files:**
- Delete: `packages/server/src/routes/chapters.ts`, `packages/server/src/routes/chapters.test.ts`
- Delete: `packages/server/src/services/tree.ts`, `packages/server/src/services/tree.test.ts`
- Delete: `packages/server/src/storage/images.ts`, `packages/server/src/storage/images.test.ts`
- Delete: `packages/server/src/routes/questions-extract.test.ts` (tested the old per-chapter extract route)

- [ ] **Step 1: Delete the files**

Run:
```bash
git -C C:/Users/olive/QuestionBank rm \
  packages/server/src/routes/chapters.ts \
  packages/server/src/routes/chapters.test.ts \
  packages/server/src/services/tree.ts \
  packages/server/src/services/tree.test.ts \
  packages/server/src/storage/images.ts \
  packages/server/src/storage/images.test.ts \
  packages/server/src/routes/questions-extract.test.ts
```

- [ ] **Step 2: Grep for any lingering references**

Run:
```bash
npx tsc --noEmit -p packages/server/tsconfig.json
```
Expected: **zero errors**. If any remain (e.g. a stray import of `ImageStore`, `Chapter`, `buildBookTree`, `deleteChapterCascade`, `imagePath`, `chapterId`), fix each at its site. Common leftovers:
- `llm/extract.ts` or its callers must not reference `imagePath` (extraction now returns text only; the scan delta route is deferred — see Task 12). If `routes/questions-extract` was the only caller of `extractQuestions` in a route, the `extract.ts` helper may now be unused by routes but still unit-tested — that's fine, leave `extract.ts` and `extract.test.ts` in place.

- [ ] **Step 3: Run the entire server suite**

Run:
```bash
npx vitest run packages/server
```
Expected: PASS — the whole suite is green on the new model.

- [ ] **Step 4: Commit**

```bash
git add -A packages/server
git commit -F .commitmsg
```
`.commitmsg`:
```
refactor(server): delete chapter routes, tree service, image store

Dead after the flat-problems rewrite: chapters, the book tree, and all
on-disk image persistence are gone.
```

---

## Task 12: Reconcile the stale docs + scan-extract note

The old chapter-based UAT draft contradicts the new model, and the scan-delta `extract` endpoint is named in the spec but deferred for the conversational round-trip. Tidy the docs so the repo's written record matches the built API.

**Files:**
- Delete or rewrite: `docs/superpowers/specs/2026-06-10-api-uat-flows.md`
- Modify (optional): `TODO.md` — mark items 16/17(partial)/9a addressed by this rewrite if the user wants; otherwise leave TODO as the forward-looking list.

- [ ] **Step 1: Decide the fate of the stale UAT draft**

Read `docs/superpowers/specs/2026-06-10-api-uat-flows.md`. It references chapters, per-chapter `/extract`, and snooze-based gating — all removed. Per the spec's "stale doc to reconcile" note, **delete it** (the new `2026-06-10-api-overview.md` is the current source of truth, and the UAT flows would need a full rewrite that isn't part of this pass):

```bash
git -C C:/Users/olive/QuestionBank rm docs/superpowers/specs/2026-06-10-api-uat-flows.md
```

> If the user would rather keep a UAT doc, instead rewrite it against the flat model (book → questions batch save, learn → grade → attempt, scan extract returning a delta). Default to deleting unless told otherwise — a half-updated UAT doc is worse than none.

- [ ] **Step 2: Add a deferred-scan note to the overview spec**

The `extract` (scan → delta) endpoint is described in the overview but **not implemented** in this pass (the conversational refine round-trip belongs to the LLM work). Append a one-line status note under the "Scan → delta ingestion" section of `docs/superpowers/specs/2026-06-10-api-overview.md` so a reader knows the route is designed but not yet built:

Find the line ending the scan section (`Image bytes are transient (TODO 3e).`) and add immediately after it:

```markdown

> **Implementation status (2026-06-10):** the flat-problems rewrite landed the
> books/questions/attempts/transcribe/grade/lookup surface. `POST …/extract`
> (scan → delta) is **designed but deferred** to the LLM work — accepted scan
> items already ride the book's batch `PUT`, so nothing else blocks on it.
```

- [ ] **Step 3: Commit the API spec, plan, and doc tidy together**

```bash
git add docs/superpowers/specs/2026-06-10-api-overview.md docs/superpowers/plans/2026-06-10-flat-problems-api.md
git add -A docs/superpowers/specs
git commit -F .commitmsg
```
`.commitmsg`:
```
docs(spec): mark flat-problems API built; drop stale chapter UAT draft
```

---

## Task 13: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck**

Run:
```bash
npm run typecheck
```
Expected: clean (exit 0), no errors across the workspace.

- [ ] **Step 2: Full test suite**

Run:
```bash
npx vitest run
```
Expected: all server tests PASS. (The client package may have its own tests from the other session; if they fail for unrelated reasons, note it but do not fix client code — this plan is server-only. Re-run scoped to the server with `npx vitest run packages/server` to confirm the rewrite itself is green.)

- [ ] **Step 3: Confirm the working tree is clean of unrelated files**

Run:
```bash
git -C C:/Users/olive/QuestionBank status --short
```
Expected: only the unrelated other-session files remain unstaged/untracked (fe-foundation plan, `packages/client/*`, `.claude/settings.local.json`, `.commitmsg`). Everything server-side is committed. Leave the other-session files exactly as they were.

- [ ] **Step 4: Update the memory record**

The implementation now exists; update `flat-problems-api-model.md`'s "Next step" line (which currently says the plan hasn't been written) to reflect that the plan landed and was implemented, and that the stale UAT draft was removed. Keep the decision record intact.

---

## Self-Review (completed during planning)

**Spec coverage** — every endpoint in `2026-06-10-api-overview.md` maps to a task:
- `GET/POST /books`, `GET/PATCH/DELETE /books/:id` → Task 5. (`?view=library` derived progress/ready is **deferred**; see gap note below.)
- `GET/PUT /books/:bookId/questions`, `GET /questions/:id` → Task 6.
- `POST /questions/:id/transcribe`, `/grade`, `POST/GET /questions/:id/attempts` → Tasks 7, 8.
- `GET /learn/next`, `GET /practice/due`, `?count=true` → Task 9.
- `GET /lookup/isbn/:isbn` → Task 10.
- `POST /books/:id/questions/extract` (scan delta) → **deferred** with an explicit status note (Task 12), consistent with the spec's "deliberately out of scope: conversational refine round-trip."

**Known intentional gaps (flagged, not silent):**
1. `GET /books?view=library` (per-book `progress%` + `ready` count) is **not v0** — confirmed deferred by the user (2026-06-10). It's a derived read depending on attempt history per book; it belongs with TODO 5a (book stats / percent completed). Tracked there as a follow-up, not in this plan.
2. The scan `extract` route is deferred (above).

**Placeholder scan:** no TBD/"add error handling"/"write tests for the above" — every code and test step contains complete content.

**Type consistency check:** `reconcileQuestionIds(questionIds, questions)`, `planBatchSave({incoming, stored, bookId, customerId, newId, nowIso})` → `{create, update, deleteIds, questionIds}`, `bookQuestionsRouter`/`questionsRouter`, `lookupRouter(fetcher?)`, `lookupIsbn(isbn, fetcher?)`/`parseOpenLibrary` — names are consistent across the tasks that define and consume them. `Attempt.answer`, `Question.bookId`/`label`, `Book.questionIds` are used identically everywhere. `createApp(store, provider, _unused?, customerConfig?)` keeps the 3rd-arg slot so existing tests passing `ImageStore`/`undefined` compile through the transition.
