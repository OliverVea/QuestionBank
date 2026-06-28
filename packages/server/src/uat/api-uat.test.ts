/**
 * API-level UAT flows — flat problems model (v0).
 *
 * ===========================================================================
 * WHAT THIS FILE IS
 * ===========================================================================
 * End-to-end acceptance tests that drive realistic user journeys purely through
 * the HTTP API (supertest over the REAL `createApp`). They exercise the
 * fully-implemented server — real persisted JSON storage in a temp dir, real
 * routing, real customer segmentation, real reconcile / batch-save / queues /
 * cascade. The ONLY faked collaborator is the LLM (`FakeProvider`): every
 * `extract` / `transcribe` / `grade` response is scripted so the flows are
 * deterministic and run offline. Everything else is the production code path.
 *
 * Storage is genuinely persisted (a real on-disk data dir per test) and cleaned
 * up in `afterEach`.
 *
 * Source of truth for the surface under test:
 *   docs/superpowers/specs/2026-06-10-api-overview.md
 *
 * ===========================================================================
 * GREEN-BY-V0 CONTRACT  (read before you panic at a red run)
 * ===========================================================================
 * These flows are written against the TARGET (post-rewrite) API, BEFORE the
 * implementation exists. That is deliberate — they are the acceptance gate for
 * the rewrite, not a description of today's server.
 *
 *   • DURING DEVELOPMENT: individual `it` flows are EXPECTED TO FAIL. They turn
 *     green surface-by-surface as each task in
 *     docs/superpowers/plans/2026-06-10-flat-problems-api.md lands (e.g. the
 *     Manage flow goes green after Task 6; the grade loop after Tasks 7–8; the
 *     queues after Task 9; segmentation once every route is re-rooted). A red
 *     flow mid-rewrite is a progress signal, not a regression.
 *
 *   • BEFORE v0 IS "READY": EVERY `it` in this file MUST PASS. A failing UAT
 *     flow is a release blocker — v0 is not done until this suite is fully
 *     green (alongside the per-unit route/service tests and `npm run
 *     typecheck`). Do not weaken, skip, or delete a flow to get green; fix the
 *     API until the flow it asserts actually holds.
 *
 * ===========================================================================
 * FLOW COVERAGE MAP  (ordered by importance)
 * ===========================================================================
 *   1. Manage ............. core authoring: POST /books → PUT/GET
 *                           /books/:id/questions (create+edit+reorder+delete in
 *                           one batch) → GET /questions/:id. The most-exercised
 *                           path; the book-Save commit.
 *   2. Validation ......... commit guards: blank title 400, malformed problem
 *                           400 (atomic — nothing written), unknown book 404.
 *   3. Reconcile .......... self-heal: an orphan question drifted out of
 *                           questionIds is re-appended on GET and persisted.
 *   4. Grade loop ......... the second commit: transcribe → grade (issues drive
 *                           the grade) → POST /attempts (the only write); plus
 *                           the 502 provider-outage path. Read-only endpoints
 *                           persist nothing.
 *   5. Queues ............. home-screen banners: GET /learn/next ordering and
 *                           GET /practice/due (+ ?count=true) SRS gating.
 *   6. Lookup ............. GET /lookup/isbn/:isbn metadata prefill surface.
 *   7. Scan ingest ........ multi-page /extract emits add/edit/skip deltas;
 *                           /refine resolves ambiguous pages; relevance scored
 *                           for goal-bearing books; accepted deltas persist via
 *                           the batch PUT.
 *   8. Cascade delete ..... DELETE /books/:id removes its questions + attempts;
 *                           an unrelated book survives.
 *   9. Segmentation (SECURITY, REQUIRED) — two customers fully isolated across
 *                           every entity; wrong-owner is 404 (not 403);
 *                           unattributed is 401. See the second describe block.
 *  10. Attempt history ... read-only book view summary (mastery/readiness/grades)
 *                           per problem + DELETE one attempt → summary re-derives;
 *                           wrong-owner delete is 404 (in the segmentation block).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { FakeProvider } from '../llm/fake-provider.js';
import { LlmError } from '../llm/provider.js';
import { requireAuth } from '../auth/index.js';
import { fakeVerifier, identityFromTokenVerifier } from '../test-support/auth.js';
import { lookupRouter } from '../routes/lookup.js';
import type { BookMetadata } from '../services/isbn-lookup.js';
import { Store } from '../storage/store.js';

// A tiny valid-enough PNG header so multipart image uploads are accepted by the mime check.
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

type App = ReturnType<typeof createApp>;

// ---------------------------------------------------------------------------
// Core flows — default-customer harness (QB_ALLOW_DEFAULT_CUSTOMER=1 via test-setup,
// so requests resolve to customer "local" without identity headers). The provider is
// re-scriptable per test via `provider`.
// ---------------------------------------------------------------------------

let dir: string;
let store: Store;
let provider: FakeProvider;
let app: App;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-uat-'));
  store = await Store.open(dir);
  provider = new FakeProvider();
  app = createApp(store, provider, undefined, fakeVerifier());
});

afterEach(async () => {
  // Real persisted storage — always clean the temp data dir up.
  await rm(dir, { recursive: true, force: true });
});

/** Create a book, returning its record. */
async function createBook(fields: Record<string, unknown> = {}): Promise<{ id: string }> {
  const res = await request(app)
    .post('/api/books')
    .send({ title: 'Calculus', ...fields });
  expect(res.status).toEqual(201);
  return res.body;
}

/** Save the full ordered problem list for a book (the batch commit), returning the saved rows. */
async function saveProblems(
  bookId: string,
  questions: Array<{ id?: string; label: string; canonicalText: string }>,
): Promise<Array<{ id: string; label: string; canonicalText: string }>> {
  const res = await request(app).put(`/api/books/${bookId}/questions`).send({ questions });
  expect(res.status).toEqual(200);
  return res.body;
}

describe('UAT: API flows on the flat problems model', () => {
  // -------------------------------------------------------------------------
  // 1. MANAGE — the central authoring path: create a book, commit a problem
  //    list, edit it (add / edit / delete / reorder in one batch), and read it
  //    back in the saved order. The single most-exercised core flow.
  // -------------------------------------------------------------------------
  it('Manage: create a book, batch-save problems, edit/reorder/delete, read back in order', async () => {
    // Create the book with metadata (add-book "Add to library", book record half).
    const book = await createBook({ author: 'Spivak', isbn: '9780914098911' });
    expect(book).toMatchObject({
      title: 'Calculus',
      author: 'Spivak',
      isbn: '9780914098911',
      questionIds: [],
    });

    // Commit the initial ordered problem list (add-book "Add to library", problems half).
    const saved = await saveProblems(book.id, [
      { label: '1', canonicalText: 'Differentiate x^2' },
      { label: '2', canonicalText: 'Integrate 2x' },
    ]);
    expect(saved.map((q) => q.canonicalText)).toEqual(['Differentiate x^2', 'Integrate 2x']);

    // book.questionIds is the order + membership authority and reflects the saved sequence.
    const reread = (await request(app).get(`/api/books/${book.id}`)).body;
    expect(reread.questionIds).toEqual(saved.map((q) => q.id));

    // Edit-book "Save changes": one batch that updates the first, reorders it last, deletes the
    // second, and adds a brand-new third — the whole working set in a single PUT.
    const [p1, p2] = saved;
    const edited = await saveProblems(book.id, [
      { label: '1', canonicalText: 'Add a problem' }, // create
      { id: p1.id, label: '2', canonicalText: 'Differentiate x^3' }, // update + moved to position 2
      // p2 omitted ⇒ deleted
    ]);
    expect(edited).toHaveLength(2);
    expect(edited[1]).toMatchObject({ id: p1.id, canonicalText: 'Differentiate x^3' });
    expect(edited.map((q) => q.id)).not.toContain(p2.id);

    // GET is the render authority and returns DERIVED path order (by label): the new
    // '1' first, then p1 (relabelled '2') — which matches `edited` here since its
    // labels are already in path order.
    const list = (await request(app).get(`/api/books/${book.id}/questions`)).body;
    expect(list.map((q: { id: string }) => q.id)).toEqual(edited.map((q) => q.id));

    // A single problem is independently readable for the learn/grade screens.
    const one = await request(app).get(`/api/questions/${p1.id}`);
    expect(one.status).toEqual(200);
    expect(one.body).toMatchObject({ id: p1.id, bookId: book.id, canonicalText: 'Differentiate x^3' });
  });

  // -------------------------------------------------------------------------
  // 2. VALIDATION — the commit guards that protect the two write paths.
  // -------------------------------------------------------------------------
  it('Validation: blank book title → 400; malformed problem item → 400; unknown book → 404', async () => {
    expect((await request(app).post('/api/books').send({ author: 'nobody' })).status).toEqual(400);
    expect((await request(app).post('/api/books').send({ title: '   ' })).status).toEqual(400);

    const book = await createBook();
    // A problem with empty canonicalText is rejected — the whole batch fails atomically.
    const bad = await request(app)
      .put(`/api/books/${book.id}/questions`)
      .send({ questions: [{ label: '1', canonicalText: '' }] });
    expect(bad.status).toEqual(400);
    // ...and nothing was written.
    expect((await request(app).get(`/api/books/${book.id}/questions`)).body).toEqual([]);

    // Operating on a non-existent book is 404 on both the read and the commit.
    expect((await request(app).get('/api/books/ghost/questions')).status).toEqual(404);
    expect(
      (await request(app).put('/api/books/ghost/questions').send({ questions: [] })).status,
    ).toEqual(404);
  });

  // -------------------------------------------------------------------------
  // 3. RECONCILE / SELF-HEAL — a half-written create (questionIds drifted from
  //    the stored questions) must surface on read, never vanish.
  // -------------------------------------------------------------------------
  it('Reconcile: an orphan question (missing from questionIds) is re-appended on read', async () => {
    const book = await createBook();
    const saved = await saveProblems(book.id, [{ label: '1', canonicalText: 'orphan-me' }]);

    // Simulate a crash between the two writes: the question exists but the book forgot its id.
    await store.books.update('local', book.id, { questionIds: [] });

    // The reconciling GET heals it back in and persists the healed order.
    const healed = await request(app).get(`/api/books/${book.id}/questions`);
    expect(healed.body.map((q: { id: string }) => q.id)).toEqual([saved[0].id]);
    const book2 = (await request(app).get(`/api/books/${book.id}`)).body;
    expect(book2.questionIds).toEqual([saved[0].id]);
  });

  // -------------------------------------------------------------------------
  // 4. GRADE LOOP — the second commit. Photo answer → transcribe (read-only) →
  //    grade (read-only, issues drive the grade) → save attempt (the only write
  //    in this loop). Then the attempt is listed and the question drops out of
  //    learn/next.
  // -------------------------------------------------------------------------
  it('Grade loop: transcribe → grade (medium issue ⇒ partial) → save attempt; nothing persists before the save', async () => {
    const book = await createBook();
    const [q] = await saveProblems(book.id, [{ label: '1', canonicalText: 'Solve x + 2 = 6' }]);

    // learn/next surfaces this un-attempted question.
    const before = await request(app).get('/api/learn/next');
    expect(before.body.question?.id).toEqual(q.id);

    // Transcribe the photographed solution — read-only, returns text, writes nothing.
    scriptProvider({ transcription: 'x = 4' });
    const transcribed = await request(app)
      .post(`/api/questions/${q.id}/transcribe`)
      .attach('images', PNG, { filename: 'ans.png', contentType: 'image/png' });
    expect(transcribed.status).toEqual(200);
    expect(transcribed.body).toEqual({ transcription: 'x = 4' });

    // Grade the confirmed answer — read-only; a medium issue ⇒ recommended "partial".
    scriptProvider({
      reasoning: 'arithmetic ok, justification thin',
      issues: [{ severity: 'medium', description: 'no working shown' }],
    });
    const graded = await request(app)
      .post(`/api/questions/${q.id}/grade`)
      .send({ conversation: [{ role: 'user', text: 'x = 4' }] });
    expect(graded.status).toEqual(200);
    expect(graded.body.recommendedGrade).toEqual('partial');

    // Nothing has been written yet — no attempts exist until the user commits.
    expect((await request(app).get(`/api/questions/${q.id}/attempts`)).body).toEqual([]);

    // Save attempt — the single write. User accepts the recommendation.
    const attempt = await request(app)
      .post(`/api/questions/${q.id}/attempts`)
      .send({
        answer: 'x = 4',
        recommendedGrade: 'partial',
        rating: 'partial',
        issues: graded.body.issues,
      });
    expect(attempt.status).toEqual(201);
    expect(attempt.body).toMatchObject({ answer: 'x = 4', rating: 'partial' });

    // It now lists, and the question is no longer the learn suggestion.
    expect((await request(app).get(`/api/questions/${q.id}/attempts`)).body).toHaveLength(1);
    const after = await request(app).get('/api/learn/next');
    expect(after.body).toEqual({ question: null });
  });

  it('Grade loop: a provider outage on transcribe/grade is a 502 and persists nothing', async () => {
    const book = await createBook();
    const [q] = await saveProblems(book.id, [{ label: '1', canonicalText: 'q' }]);

    provider.failWith(new LlmError('backend down'));
    const transcribe = await request(app)
      .post(`/api/questions/${q.id}/transcribe`)
      .attach('images', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(transcribe.status).toEqual(502);

    provider.failWith(new LlmError('backend down'));
    const grade = await request(app)
      .post(`/api/questions/${q.id}/grade`)
      .send({ conversation: [{ role: 'user', text: 'x = 4' }] });
    expect(grade.status).toEqual(502);

    // No attempt was created by either failed read-only call.
    expect((await request(app).get(`/api/questions/${q.id}/attempts`)).body).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 5. QUEUES — what the home screen banners ask for: the next thing to learn
  //    and the count due for review. A freshly-attempted question is not yet
  //    due (SRS gating), so the revisit count stays 0 right after a first grade.
  // -------------------------------------------------------------------------
  it('Queues: learn/next walks derived path order; a just-attempted question is not yet practice-due', async () => {
    const book = await createBook();
    const [first, second] = await saveProblems(book.id, [
      { label: '1', canonicalText: 'first' },
      { label: '2', canonicalText: 'second' },
    ]);

    // learn/next yields the first un-attempted question, in derived path order (by label).
    expect((await request(app).get('/api/learn/next')).body.question.id).toEqual(first.id);

    // Attempt the first → learn/next advances to the second; the first is not yet due.
    await request(app)
      .post(`/api/questions/${first.id}/attempts`)
      .send({ answer: 'a', recommendedGrade: 'correct', rating: 'correct', issues: [] });

    expect((await request(app).get('/api/learn/next')).body.question.id).toEqual(second.id);

    // practice/due is empty (freshly attempted is scheduled into the future), and the
    // count form backs the revisit banner number.
    expect((await request(app).get('/api/practice/due')).body).toEqual([]);
    expect((await request(app).get('/api/practice/due?count=true')).body).toEqual({ count: 0 });
  });

  // Display + learn order is DERIVED from the dotted-path label, NOT save order:
  // save out-of-order and confirm both the questions GET and learn/next re-sort by path.
  it('Ordering: questions GET and learn/next sort by dotted-path label, not save order', async () => {
    const book = await createBook();
    // Saved deliberately out of path order; numeric-aware so 1.A.2 precedes 1.A.10.
    await saveProblems(book.id, [
      { label: '2.3', canonicalText: 'chapter-2 loose' },
      { label: '1.A.10', canonicalText: 'tenth' },
      { label: '1.A.2', canonicalText: 'second' },
      { label: '1.B.1', canonicalText: 'b-one' },
    ]);

    const list = (await request(app).get(`/api/books/${book.id}/questions`)).body;
    expect(list.map((q: { label: string }) => q.label)).toEqual(['1.A.2', '1.A.10', '1.B.1', '2.3']);

    // learn/next follows the same derived order: the path-first un-attempted problem.
    expect((await request(app).get('/api/learn/next')).body.question.canonicalText).toEqual('second');
  });

  // -------------------------------------------------------------------------
  // LANDING — the home screen's two read models: GET /books/summaries (per-book
  // derived progress/dueNow/learnNext, reconciling with the book-detail view)
  // and GET /activity (global streak + weekly-goal header metrics).
  // -------------------------------------------------------------------------
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
    expect(mine.summary.progress).toBeGreaterThan(0);                 // one improving/strong problem
    // second is next; chapter 1 already has an attempt (1.A.1) ⇒ started (continue, not start).
    expect(mine.summary.learnNext).toEqual({ label: '1.A.2', pathPrefix: '1', started: true });
    // dueNow = attempted-and-due (matches the revisit queue): `first` is freshly attempted
    // (scheduled into the future ⇒ waiting), `second` is never-attempted (learn material, not
    // revisit). Neither is due-for-revisit ⇒ 0.
    expect(mine.summary.dueNow).toBe(0);
    void second;

    const activity = (await request(app).get('/api/activity')).body;
    expect(activity).toMatchObject({ daysGoal: 3, problemsGoal: 20 });
    expect(activity.streak).toBeGreaterThanOrEqual(1);               // attempted today
    expect(activity.problemsThisWeek).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // SETTINGS — user-editable weekly goals. GET defaults to the constants until a
  // customer saves; PUT upserts the per-customer record and the new targets then
  // flow through to the activity header. Invalid goals are rejected (400).
  // -------------------------------------------------------------------------
  it('Settings: GET defaults, PUT upserts goals + pauseEvery, and /activity reflects the new targets', async () => {
    // No record yet ⇒ GET returns the defaults the header would otherwise hardcode (pauseEvery defaults to 10).
    const initial = (await request(app).get('/api/settings')).body;
    expect(initial).toEqual({ daysGoal: 3, problemsGoal: 20, pauseEvery: 10 });
    expect((await request(app).get('/api/activity')).body).toMatchObject({ daysGoal: 3, problemsGoal: 20 });

    // Upsert goals WITHOUT pauseEvery (back-compat body) — pauseEvery defaults to 10 in the response.
    const saved = await request(app).put('/api/settings').send({ daysGoal: 5, problemsGoal: 40 });
    expect(saved.status).toEqual(200);
    expect(saved.body).toEqual({ daysGoal: 5, problemsGoal: 40, pauseEvery: 10 });

    // GET now reads the stored record, and the new targets flow into the activity header (which ignores pauseEvery).
    expect((await request(app).get('/api/settings')).body).toEqual({ daysGoal: 5, problemsGoal: 40, pauseEvery: 10 });
    expect((await request(app).get('/api/activity')).body).toMatchObject({ daysGoal: 5, problemsGoal: 40 });

    // PUT WITH pauseEvery stores it; GET reflects it.
    const withPause = await request(app).put('/api/settings').send({ daysGoal: 2, problemsGoal: 15, pauseEvery: 5 });
    expect(withPause.body).toEqual({ daysGoal: 2, problemsGoal: 15, pauseEvery: 5 });
    expect((await request(app).get('/api/settings')).body).toEqual({ daysGoal: 2, problemsGoal: 15, pauseEvery: 5 });

    // Guards: days out of 1–7, problems < 1, non-integers, and bad pauseEvery are all 400; nothing persists.
    expect((await request(app).put('/api/settings').send({ daysGoal: 0, problemsGoal: 15 })).status).toEqual(400);
    expect((await request(app).put('/api/settings').send({ daysGoal: 8, problemsGoal: 15 })).status).toEqual(400);
    expect((await request(app).put('/api/settings').send({ daysGoal: 3, problemsGoal: 0 })).status).toEqual(400);
    expect((await request(app).put('/api/settings').send({ daysGoal: 3.5, problemsGoal: 15 })).status).toEqual(400);
    expect((await request(app).put('/api/settings').send({ daysGoal: 3, problemsGoal: 15, pauseEvery: 0 })).status).toEqual(400);
    expect((await request(app).put('/api/settings').send({ daysGoal: 3, problemsGoal: 15, pauseEvery: 2.5 })).status).toEqual(400);
    // The last good save is intact after the rejected ones.
    expect((await request(app).get('/api/settings')).body).toEqual({ daysGoal: 2, problemsGoal: 15, pauseEvery: 5 });
  });

  // -------------------------------------------------------------------------
  // 6. ISBN LOOKUP — metadata prefill for add/edit-book. Read-only, network-
  //    backed; here the catalog is the test's, but the route is the real one.
  //    (The production fetcher is injected at the route; this verifies the
  //    surface exists and the customer middleware still gates it.)
  // -------------------------------------------------------------------------
  it('Lookup: GET /lookup/isbn/:isbn returns mapped metadata (or 404 when unknown)', async () => {
    // Like the LLM, the external catalog is the one faked collaborator here: we mount the REAL
    // lookupRouter behind the REAL customer middleware, but inject an offline fetcher so the flow
    // is deterministic and never touches the network. A known ISBN returns an Open-Library-shaped
    // record (exercising the real parseOpenLibrary mapping); an unknown one returns nothing.
    const KNOWN = '9780914098911';
    const fakeFetcher = async (isbn: string): Promise<unknown> =>
      isbn === KNOWN
        ? {
            title: 'Calculus',
            authors: [{ name: 'Michael Spivak' }],
            publishers: [{ name: 'Publish or Perish' }],
            publish_date: '2008',
          }
        : undefined;
    const lookupApp = express();
    lookupApp.use('/api', requireAuth(fakeVerifier()));
    lookupApp.use('/api/lookup', lookupRouter(fakeFetcher));

    const hit = await request(lookupApp).get(`/api/lookup/isbn/${KNOWN}`);
    expect(hit.status).toEqual(200);
    expect(hit.body as BookMetadata).toMatchObject({
      title: 'Calculus',
      author: 'Michael Spivak',
      publisher: 'Publish or Perish',
      year: 2008,
    });

    // An ISBN the catalog has no record for surfaces as a clean 404, not a partial/empty 200.
    const miss = await request(lookupApp).get('/api/lookup/isbn/0000000000000');
    expect(miss.status).toEqual(404);
  });

  // -------------------------------------------------------------------------
  // 7. SCAN INGEST — multi-page extract: the model sees the book's existing
  //    problems and emits add/edit/skip. A re-scanned known problem is a skip;
  //    a new one is an add. Extract persists nothing; the accepted add commits
  //    through the same batch PUT as any other edit.
  // -------------------------------------------------------------------------
  it('Scan ingest: extract skips a known problem + adds a new one; the add commits via batch PUT', async () => {
    const book = await createBook();
    const [known] = await saveProblems(book.id, [{ label: '1.A.1', canonicalText: 'Differentiate x^2' }]);

    // Script the model: skip the known problem (by its id), add a new one.
    const scanApp = createApp(
      store,
      new FakeProvider({
        structured: {
          resolved: [
            { kind: 'skip', canonicalText: 'Differentiate x^2', targetId: known.id },
            { kind: 'add', path: '1.A.2', canonicalText: 'Integrate 2x' },
          ],
          needsSection: [],
        },
      }),
      undefined,
      fakeVerifier(),
    );

    const extract = await request(scanApp)
      .post('/api/extract')
      .field('bookId', book.id)
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' })
      .attach('images', PNG, { filename: 'p2.png', contentType: 'image/png' });
    expect(extract.status).toEqual(200);
    expect(extract.body.resolved.map((d: { kind: string }) => d.kind)).toEqual(['skip', 'add']);

    // Extract persisted nothing — the book still has just the one known problem.
    expect((await request(app).get(`/api/books/${book.id}/questions`)).body).toHaveLength(1);

    // The user accepts the `add` and commits via the normal batch PUT: keep the existing
    // problem (by id) and append the new one (label = its path).
    const add = extract.body.resolved.find((d: { kind: string }) => d.kind === 'add');
    const saved = await saveProblems(book.id, [
      { id: known.id, label: '1.A.1', canonicalText: 'Differentiate x^2' },
      { label: add.path, canonicalText: add.canonicalText },
    ]);
    expect(saved.map((q) => q.canonicalText)).toEqual(['Differentiate x^2', 'Integrate 2x']);
    expect(saved.map((q) => q.label)).toEqual(['1.A.1', '1.A.2']);
  });

  // -------------------------------------------------------------------------
  // 7b. SCAN AMBIGUITY ROUND-TRIP — a page with bare numbers comes back under
  //     needsSection; the user supplies the section prefix; /refine folds those
  //     problems into resolved as adds under that prefix and clears needsSection.
  //     The commit then persists them via the batch PUT.
  // -------------------------------------------------------------------------
  it('Scan ambiguity: a needsSection page is resolved via /refine, then commits', async () => {
    const book = await createBook();

    // First pass: the model can't place page 2's bare "4", so it flags needsSection.
    const extractApp = createApp(
      store,
      new FakeProvider({
        structured: {
          resolved: [{ kind: 'add', path: '1.A.1', canonicalText: 'Differentiate x^2' }],
          needsSection: [{ pageIndex: 1, problems: [{ localLabel: '4', canonicalText: 'Integrate 4x' }] }],
        },
      }),
      undefined,
      fakeVerifier(),
    );

    const first = await request(extractApp)
      .post('/api/extract')
      .field('bookId', book.id)
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' })
      .attach('images', PNG, { filename: 'p2.png', contentType: 'image/png' });
    expect(first.status).toEqual(200);
    expect(first.body.needsSection).toHaveLength(1);
    expect(first.body.needsSection[0].pageIndex).toEqual(1);

    // Second pass: the user answered "page 1 → 1.A". The refined model now folds the
    // bare "4" into resolved as an add under "1.A.4" and returns an empty needsSection.
    const refineApp = createApp(
      store,
      new FakeProvider({
        structured: {
          resolved: [
            { kind: 'add', path: '1.A.1', canonicalText: 'Differentiate x^2' },
            { kind: 'add', path: '1.A.4', canonicalText: 'Integrate 4x' },
          ],
          needsSection: [],
        },
      }),
      undefined,
      fakeVerifier(),
    );

    const refined = await request(refineApp)
      .post('/api/extract/refine')
      .field('bookId', book.id)
      .field('currentExtraction', JSON.stringify(first.body))
      .field('sectionAnswers', JSON.stringify({ '1': '1.A' }))
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' })
      .attach('images', PNG, { filename: 'p2.png', contentType: 'image/png' });
    expect(refined.status).toEqual(200);
    expect(refined.body.needsSection).toEqual([]);
    expect(refined.body.resolved.map((d: { path: string }) => d.path)).toEqual(['1.A.1', '1.A.4']);

    // The user's section answer reached the refine conversation (the correction turn).
    // (Asserted indirectly here via the resolved paths; the transcript shape is unit-tested
    // in the route test. The refine request must carry sectionAnswers as a multipart field.)

    // Commit both adds via the batch PUT.
    const saved = await saveProblems(
      book.id,
      refined.body.resolved.map((d: { path: string; canonicalText: string }) => ({
        label: d.path,
        canonicalText: d.canonicalText,
      })),
    );
    expect(saved.map((q) => q.label)).toEqual(['1.A.1', '1.A.4']);
  });

  // -------------------------------------------------------------------------
  // 7c. SCAN RELEVANCE — a goal-bearing book scores each extracted problem's
  //     relevance; committing the accepted add via the batch PUT persists that
  //     relevance onto the stored question. Proves the multi-page flow does not
  //     regress the existing relevance feature end-to-end.
  // -------------------------------------------------------------------------
  it('Scan relevance: extract scores relevance for a goal-bearing book; commit persists it', async () => {
    const book = await createBook({ learningGoal: 'master integration' });

    const scanApp = createApp(
      store,
      new FakeProvider({
        structured: {
          resolved: [{ kind: 'add', path: '3.1', canonicalText: 'Integrate sin x', relevance: 'high' }],
          needsSection: [],
        },
      }),
      undefined,
      fakeVerifier(),
    );

    const extract = await request(scanApp)
      .post('/api/extract')
      .field('bookId', book.id)
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });
    expect(extract.status).toEqual(200);
    const add = extract.body.resolved[0];
    expect(add.relevance).toEqual('high');

    // Commit through the batch PUT carrying the scored relevance (the path the scan page
    // uses: label = path, plus relevance). The questions route persists relevance.
    const put = await request(app)
      .put(`/api/books/${book.id}/questions`)
      .send({ questions: [{ label: add.path, canonicalText: add.canonicalText, relevance: add.relevance }] });
    expect(put.status).toEqual(200);

    // The stored question carries the relevance, visible on the book-questions read.
    const list = (await request(app).get(`/api/books/${book.id}/questions`)).body;
    expect(list[0].relevance).toEqual('high');
  });

  // -------------------------------------------------------------------------
  // 8. CASCADE DELETE — deleting a book removes its problems and their attempts;
  //    an unrelated book is untouched. (manage-books delete.)
  // -------------------------------------------------------------------------
  it('Cascade delete: removing a book drops its questions + attempts; another book survives', async () => {
    const doomed = await createBook({ title: 'Doomed' });
    const survivor = await createBook({ title: 'Survivor' });

    const [dq] = await saveProblems(doomed.id, [{ label: '1', canonicalText: 'd' }]);
    const [sq] = await saveProblems(survivor.id, [{ label: '1', canonicalText: 's' }]);
    await request(app)
      .post(`/api/questions/${dq.id}/attempts`)
      .send({ answer: 'a', recommendedGrade: 'correct', rating: 'correct', issues: [] });

    const del = await request(app).delete(`/api/books/${doomed.id}`);
    expect(del.status).toEqual(204);

    // The book, its question, and the attempt are all gone.
    expect((await request(app).get(`/api/books/${doomed.id}`)).status).toEqual(404);
    expect((await request(app).get(`/api/questions/${dq.id}`)).status).toEqual(404);
    expect((await request(app).get(`/api/questions/${dq.id}/attempts`)).status).toEqual(404);

    // The unrelated book and its question survive intact.
    expect((await request(app).get(`/api/books/${survivor.id}`)).status).toEqual(200);
    expect((await request(app).get(`/api/questions/${sq.id}`)).status).toEqual(200);
  });

  // -------------------------------------------------------------------------
  // 10. ATTEMPT HISTORY — the read-only book view + attempt review/delete. The
  //     book-questions list carries a derived summary per problem (mastery word,
  //     readiness color, per-attempt grades), and an individual attempt can be
  //     deleted, after which the summary re-derives from the remaining history.
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

  /** Swap the running app onto a freshly-scripted provider mid-test. */
  function scriptProvider(structured: unknown): FakeProvider {
    const p = new FakeProvider({ structured });
    app = createApp(store, p, undefined, fakeVerifier());
    return p;
  }
});

// ---------------------------------------------------------------------------
// REQUIRED SECURITY UAT — customer segmentation.
//
// Re-mounts the app with a STRICT config: identity comes from X-Customer-Id and
// there is NO default-customer fallback, so an unattributed request is 401. This
// is the real production posture (the default-customer fallback is a dev/test
// convenience only). Two customers must be fully isolated across every entity,
// and wrong-owner access must be indistinguishable from "does not exist" (404),
// never a 403 that would confirm the resource exists.
// ---------------------------------------------------------------------------

describe('UAT (security): customer segmentation is airtight', () => {
  const A = 'alice';
  const B = 'bob';

  let segDir: string;
  let segStore: Store;
  let segApp: App;

  beforeEach(async () => {
    segDir = await mkdtemp(join(tmpdir(), 'qb-uat-seg-'));
    segStore = await Store.open(segDir);
    segApp = createApp(segStore, new FakeProvider(), undefined, identityFromTokenVerifier());
  });

  afterEach(async () => {
    await rm(segDir, { recursive: true, force: true });
  });

  /** Tag a supertest request with a customer identity (token value = customer id). */
  const as = (r: request.Test, customer: string) => r.set('Authorization', `Bearer ${customer}`);

  /** Seed a book → question → attempt chain owned by `customer`; return their ids. */
  async function seedChain(customer: string): Promise<{ bookId: string; questionId: string }> {
    const bookId = (await as(request(segApp).post('/api/books'), customer).send({ title: 'Book' })).body.id;
    const saved = (
      await as(request(segApp).put(`/api/books/${bookId}/questions`), customer).send({
        questions: [{ label: '1', canonicalText: 'q' }],
      })
    ).body;
    const questionId = saved[0].id;
    await as(request(segApp).post(`/api/questions/${questionId}/attempts`), customer).send({
      answer: 'a',
      recommendedGrade: 'correct',
      rating: 'correct',
      issues: [],
    });
    return { bookId, questionId };
  }

  it('rejects an unattributed request with 401 (no default-customer fallback)', async () => {
    expect((await request(segApp).get('/api/books')).status).toEqual(401);
    expect((await request(segApp).post('/api/books').send({ title: 'X' })).status).toEqual(401);
    expect((await request(segApp).get('/api/learn/next')).status).toEqual(401);
  });

  it('lists only the requesting customer\'s books; A and B never overlap', async () => {
    await seedChain(A);
    await seedChain(B);

    const aBooks = await as(request(segApp).get('/api/books'), A);
    const bBooks = await as(request(segApp).get('/api/books'), B);
    expect(aBooks.body).toHaveLength(1);
    expect(bBooks.body).toHaveLength(1);
    expect(aBooks.body[0].id).not.toEqual(bBooks.body[0].id);
  });

  it('A cannot read, patch, or commit problems to B\'s book (wrong-owner is 404, not 403)', async () => {
    const { bookId } = await seedChain(B);

    expect((await as(request(segApp).get(`/api/books/${bookId}`), A)).status).toEqual(404);
    expect(
      (await as(request(segApp).patch(`/api/books/${bookId}`), A).send({ title: 'hijack' })).status,
    ).toEqual(404);
    // The problem-list read and commit are book-scoped, so they too are 404 for the wrong owner.
    expect((await as(request(segApp).get(`/api/books/${bookId}/questions`), A)).status).toEqual(404);
    expect(
      (
        await as(request(segApp).put(`/api/books/${bookId}/questions`), A).send({
          questions: [{ label: '1', canonicalText: 'x' }],
        })
      ).status,
    ).toEqual(404);

    // B's book is untouched after A's probing.
    const stillThere = await as(request(segApp).get(`/api/books/${bookId}`), B);
    expect(stillThere.status).toEqual(200);
    expect(stillThere.body.title).toEqual('Book');
  });

  it('A cannot read B\'s question nor list/create its attempts (404 throughout)', async () => {
    const { questionId } = await seedChain(B);

    expect((await as(request(segApp).get(`/api/questions/${questionId}`), A)).status).toEqual(404);
    expect(
      (await as(request(segApp).get(`/api/questions/${questionId}/attempts`), A)).status,
    ).toEqual(404);
    expect(
      (
        await as(request(segApp).post(`/api/questions/${questionId}/attempts`), A).send({
          answer: 'a',
          recommendedGrade: 'correct',
          rating: 'correct',
          issues: [],
        })
      ).status,
    ).toEqual(404);

    // B still sees its own attempt — A's probing changed nothing.
    const bAttempts = await as(request(segApp).get(`/api/questions/${questionId}/attempts`), B);
    expect(bAttempts.status).toEqual(200);
    expect(bAttempts.body).toHaveLength(1);
  });

  it('A cannot delete B\'s attempt (wrong-owner is 404, and B\'s attempt survives)', async () => {
    const { questionId } = await seedChain(B);
    const bAttemptId = (await as(request(segApp).get(`/api/questions/${questionId}/attempts`), B))
      .body[0].id;

    // A probing the delete endpoint on B's question/attempt is 404 — never confirms existence.
    expect(
      (
        await as(
          request(segApp).delete(`/api/questions/${questionId}/attempts/${bAttemptId}`),
          A,
        )
      ).status,
    ).toEqual(404);

    // B's attempt is untouched.
    const bAttempts = await as(request(segApp).get(`/api/questions/${questionId}/attempts`), B);
    expect(bAttempts.body).toHaveLength(1);
  });

  it('learn/next and practice/due are scoped per customer; B\'s data never leaks to A', async () => {
    // B has an attempted (and thus not-learn-eligible) question. A has a fresh one.
    await seedChain(B);
    const aBookId = (await as(request(segApp).post('/api/books'), A).send({ title: 'A-Book' })).body.id;
    await as(request(segApp).put(`/api/books/${aBookId}/questions`), A).send({
      questions: [{ label: '1', canonicalText: 'a-q' }],
    });

    // A's learn/next surfaces A's question, never B's.
    const aNext = await as(request(segApp).get('/api/learn/next'), A);
    expect(aNext.body.question?.canonicalText).toEqual('a-q');

    // A's due queue is empty — B's seeded attempt never crosses the boundary.
    const aDue = await as(request(segApp).get('/api/practice/due'), A);
    expect(aDue.body).toEqual([]);
  });

  it('settings goals are per-customer: A\'s saved goals never leak into B\'s', async () => {
    // A saves custom goals; B never does.
    expect(
      (await as(request(segApp).put('/api/settings'), A).send({ daysGoal: 6, problemsGoal: 50 })).status,
    ).toEqual(200);

    // A reads back A's goals; B still sees the untouched defaults.
    expect((await as(request(segApp).get('/api/settings'), A)).body).toEqual({ daysGoal: 6, problemsGoal: 50, pauseEvery: 10 });
    expect((await as(request(segApp).get('/api/settings'), B)).body).toEqual({ daysGoal: 3, problemsGoal: 20, pauseEvery: 10 });
    // ...and the boundary holds through the activity header too.
    expect((await as(request(segApp).get('/api/activity'), B)).body).toMatchObject({ daysGoal: 3, problemsGoal: 20 });
  });

  it('cascade delete is customer-scoped: A deleting B\'s book id is a no-op for B', async () => {
    const { bookId } = await seedChain(B);

    // Delete is idempotent, so A's call returns 204 — but it must touch nothing of B's.
    const del = await as(request(segApp).delete(`/api/books/${bookId}`), A);
    expect(del.status).toEqual(204);

    const survives = await as(request(segApp).get(`/api/books/${bookId}`), B);
    expect(survives.status).toEqual(200);
    expect((await as(request(segApp).get(`/api/books/${bookId}/questions`), B)).body).toHaveLength(1);
  });
});
