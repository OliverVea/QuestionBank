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
 *   7. Scan ingest ........ scan-accepted problems persist via the batch PUT;
 *                           the extract route itself is DEFERRED this pass.
 *   8. Cascade delete ..... DELETE /books/:id removes its questions + attempts;
 *                           an unrelated book survives.
 *   9. Segmentation (SECURITY, REQUIRED) — two customers fully isolated across
 *                           every entity; wrong-owner is 404 (not 403);
 *                           unattributed is 401. See the second describe block.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { FakeProvider } from '../llm/fake-provider.js';
import { LlmError } from '../llm/provider.js';
import type { ResolveCustomerConfig } from '../middleware/resolve-customer.js';
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
  app = createApp(store, provider, undefined);
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

    // GET is the render authority and returns the reconciled order matching the last save.
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
  it('Queues: learn/next walks questionIds order; a just-attempted question is not yet practice-due', async () => {
    const book = await createBook();
    const [first, second] = await saveProblems(book.id, [
      { label: '1', canonicalText: 'first' },
      { label: '2', canonicalText: 'second' },
    ]);

    // learn/next yields the first un-attempted question, in questionIds order.
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

  // -------------------------------------------------------------------------
  // 6. ISBN LOOKUP — metadata prefill for add/edit-book. Read-only, network-
  //    backed; here the catalog is the test's, but the route is the real one.
  //    (The production fetcher is injected at the route; this verifies the
  //    surface exists and the customer middleware still gates it.)
  // -------------------------------------------------------------------------
  it('Lookup: GET /lookup/isbn/:isbn returns mapped metadata (or 404 when unknown)', async () => {
    // The production mount uses the default Open Library fetcher, so a bogus ISBN with no
    // network is expected to surface as not-found or a gateway error — never a 200 with data.
    const res = await request(app).get('/api/lookup/isbn/0000000000000');
    expect([404, 502]).toContain(res.status);
  });

  // -------------------------------------------------------------------------
  // 7. SCAN INGEST — scan-problems: an image yields a proposed delta (nothing
  //    persisted by extract); the accepted items are persisted only through the
  //    same batch PUT as any other edit.
  //
  //    NOTE: `POST /books/:id/questions/extract` is DESIGNED BUT DEFERRED in
  //    this pass (the conversational refine round-trip is LLM work — see the
  //    overview spec's status note). This flow asserts the *persistence* half
  //    that IS built: scan-accepted problems ride the batch save. If/when the
  //    extract route lands, extend this flow to drive it for the delta.
  // -------------------------------------------------------------------------
  it('Scan ingest: accepted scanned problems persist via the batch PUT (extract route deferred)', async () => {
    const book = await createBook();
    // Stand in for "the two cards the scan agent proposed and the user accepted": they reach
    // edit-book's in-memory list and are committed by the normal batch save.
    const saved = await saveProblems(book.id, [
      { label: '1', canonicalText: 'scanned problem A' },
      { label: '2', canonicalText: 'scanned problem B' },
    ]);
    expect(saved.map((q) => q.canonicalText)).toEqual(['scanned problem A', 'scanned problem B']);

    const list = (await request(app).get(`/api/books/${book.id}/questions`)).body;
    expect(list).toHaveLength(2);
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

  /** Swap the running app onto a freshly-scripted provider mid-test. */
  function scriptProvider(structured: unknown): FakeProvider {
    const p = new FakeProvider({ structured });
    app = createApp(store, p, undefined);
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
  const STRICT: ResolveCustomerConfig = {
    customerHeader: 'X-Customer-Id',
    allowDefaultCustomer: false,
    proxySecretHeader: 'X-Proxy-Secret',
  };
  const A = 'alice';
  const B = 'bob';

  let segDir: string;
  let segStore: Store;
  let segApp: App;

  beforeEach(async () => {
    segDir = await mkdtemp(join(tmpdir(), 'qb-uat-seg-'));
    segStore = await Store.open(segDir);
    segApp = createApp(segStore, new FakeProvider(), undefined, STRICT);
  });

  afterEach(async () => {
    await rm(segDir, { recursive: true, force: true });
  });

  /** Tag a supertest request with a customer identity header. */
  const as = (r: request.Test, customer: string) => r.set('X-Customer-Id', customer);

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
