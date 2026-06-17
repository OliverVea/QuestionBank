/**
 * After-beta HTTP smoke suite — runs ONLY in the pipeline's `test-after-beta` step,
 * against the actually-deployed beta instance, after `deploy-beta` and before `deploy` (prod).
 *
 * ===========================================================================
 * WHAT THIS FILE IS
 * ===========================================================================
 * A thin black-box layer that proves the *deployed* beta artifact serves its
 * LLM-free surface correctly over real HTTP. It does NOT mount `createApp` — it
 * hits `process.env.QB_BETA_BASE_URL` (the in-cluster beta Service URL) with
 * supertest issuing real requests. The deep API logic (reconcile, batch-save,
 * SRS queues, segmentation, the LLM-driven extract/transcribe/grade flows) is
 * already proven for free, offline, by the in-process `src/uat/api-uat.test.ts`
 * suite against a scripted FakeProvider — this layer only adds "the live box is
 * up and wired".
 *
 * ===========================================================================
 * WHY IT IS GUARDED / WHAT IT MUST NOT DO
 * ===========================================================================
 *   • REQUIRES `QB_BETA_BASE_URL`. It throws at import when unset, so a normal
 *     `npm test` (which never sets it) never runs this and never tries to reach
 *     the network. It is invoked explicitly by name: `npm run test:beta`
 *     (vitest --project beta).
 *
 *   • IDENTITY: beta runs QB_ALLOW_DEFAULT_CUSTOMER=0 (strict) and normally has
 *     its identity injected by the ingress forwardAuth. Hitting the Service URL
 *     bypasses the ingress, so EVERY /api request must send the customer header
 *     itself: `X-authentik-uid: pipeline-smoke`. That value doubles as a
 *     dedicated, isolated TENANT — these test writes never touch real beta
 *     users' data, and there is no separate test DB.
 *
 *   • MUST NOT exercise LLM routes — beta wires a real ANTHROPIC_API_KEY (real
 *     money): no POST /api/extract(/refine), /api/questions/:id/transcribe(/retry),
 *     or /api/questions/:id/grade. Only the LLM-free surface is asserted here.
 *
 *   • Best-effort teardown: every book this suite creates is deleted in afterAll
 *     (cascades to its questions + attempts) so the `pipeline-smoke` tenant does
 *     not accrete data run over run. Teardown failures are swallowed — a smoke
 *     run must not go red over cleanup.
 */
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

const BASE_URL = process.env.QB_BETA_BASE_URL;
if (!BASE_URL) {
  // Hard guard: this suite is meaningless (and would hang on the network) without a
  // target. Throwing at import keeps it out of any run that hasn't opted in explicitly.
  throw new Error(
    'QB_BETA_BASE_URL is required for the beta smoke suite (e.g. ' +
      'QB_BETA_BASE_URL=http://questionbank.apps-beta.svc.cluster.local). ' +
      'This suite is excluded from `npm test`; run it via `npm run test:beta`.',
  );
}

// The dedicated tenant header. Sending it both authenticates past the strict
// in-cluster check AND scopes every write to an isolated `pipeline-smoke` tenant.
const UID = 'pipeline-smoke';

/** A supertest agent bound to the live beta base URL. */
const agent = request(BASE_URL);

/** Issue a request with the identity header pre-stamped. */
function authed(method: 'get' | 'post' | 'put' | 'delete', path: string) {
  return agent[method](path).set('X-authentik-uid', UID);
}

// Books created during the run, torn down at the end (cascade removes questions + attempts).
const createdBookIds: string[] = [];

afterAll(async () => {
  for (const id of createdBookIds) {
    try {
      await authed('delete', `/api/books/${id}`);
    } catch {
      // Best-effort only — never fail the smoke run over teardown.
    }
  }
});

describe('beta deployment smoke (LLM-free surface)', () => {
  it('serves health without an identity header', async () => {
    // Health is the open readiness probe — no header needed.
    const res = await agent.get('/api/health');
    expect(res.status).toEqual(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('rejects an unauthenticated /api read with 401', async () => {
    // Confirms strict mode is live on the deployed instance: no header → 401.
    // (If this ever returns 200, beta is mis-deployed in permissive mode.)
    const res = await agent.get('/api/books');
    expect(res.status).toEqual(401);
  });

  it('creates a book and reads it back', async () => {
    const create = await authed('post', '/api/books').send({
      title: 'Pipeline smoke book',
      author: 'CI',
    });
    expect(create.status).toEqual(201);
    expect(create.body.id).toEqual(expect.any(String));
    expect(create.body).toMatchObject({ title: 'Pipeline smoke book', customerId: UID });
    createdBookIds.push(create.body.id);

    const read = await authed('get', `/api/books/${create.body.id}`);
    expect(read.status).toEqual(200);
    expect(read.body).toMatchObject({ id: create.body.id, title: 'Pipeline smoke book' });

    // The new book is visible in the tenant's list.
    const list = await authed('get', '/api/books');
    expect(list.status).toEqual(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.some((b: { id: string }) => b.id === create.body.id)).toBe(true);
  });

  it('batch-upserts questions and reads one back', async () => {
    const book = await authed('post', '/api/books').send({ title: 'Smoke questions book' });
    expect(book.status).toEqual(201);
    createdBookIds.push(book.body.id);

    const save = await authed('put', `/api/books/${book.body.id}/questions`).send({
      questions: [
        { label: '1', canonicalText: 'What is 2 + 2?' },
        { label: '2', canonicalText: 'State the fundamental theorem of calculus.' },
      ],
    });
    expect(save.status).toEqual(200);
    expect(Array.isArray(save.body)).toBe(true);
    expect(save.body).toHaveLength(2);
    const [q1] = save.body;
    expect(q1).toMatchObject({ label: '1', canonicalText: 'What is 2 + 2?', bookId: book.body.id });

    // Flat single-question read of a persisted question.
    const one = await authed('get', `/api/questions/${q1.id}`);
    expect(one.status).toEqual(200);
    expect(one.body).toMatchObject({ id: q1.id, label: '1' });

    // The book-questions list returns each question enriched with a derived summary.
    const listed = await authed('get', `/api/books/${book.body.id}/questions`);
    expect(listed.status).toEqual(200);
    expect(listed.body).toHaveLength(2);
    expect(listed.body[0].summary).toEqual(
      expect.objectContaining({ mastery: expect.any(String), readiness: expect.any(String) }),
    );
  });

  it('records an attempt (LLM-free write) and reflects it in reads', async () => {
    const book = await authed('post', '/api/books').send({ title: 'Smoke attempts book' });
    createdBookIds.push(book.body.id);
    const save = await authed('put', `/api/books/${book.body.id}/questions`).send({
      questions: [{ label: '1', canonicalText: 'Define a derivative.' }],
    });
    const questionId = save.body[0].id;

    // Attempts are written directly (no grader call) — the grade fields are supplied by the
    // client after the LLM turn, so the write path itself is LLM-free.
    const attempt = await authed('post', `/api/questions/${questionId}/attempts`).send({
      answer: 'The instantaneous rate of change of a function.',
      recommendedGrade: 'correct',
      rating: 'correct',
      issues: [],
    });
    expect(attempt.status).toEqual(201);
    expect(attempt.body).toMatchObject({ questionId, rating: 'correct' });

    const list = await authed('get', `/api/questions/${questionId}/attempts`);
    expect(list.status).toEqual(200);
    expect(list.body.some((a: { id: string }) => a.id === attempt.body.id)).toBe(true);
  });

  it('serves the learn-next suggestion endpoint', async () => {
    // Shape only — content depends on the tenant's accumulated state. Either a question
    // or the explicit null sentinel is valid; both prove the endpoint is wired.
    const res = await authed('get', '/api/learn/next');
    expect(res.status).toEqual(200);
    expect(res.body).toHaveProperty('question');
  });

  it('serves the practice-due queue and its count shape', async () => {
    const list = await authed('get', '/api/practice/due');
    expect(list.status).toEqual(200);
    expect(Array.isArray(list.body)).toBe(true);

    const count = await authed('get', '/api/practice/due?count=true');
    expect(count.status).toEqual(200);
    expect(count.body).toEqual({ count: expect.any(Number) });
  });

  it('serves the isbn lookup endpoint', async () => {
    // This hits an EXTERNAL catalog (Open Library), so reachability from the cluster is not
    // guaranteed and is not what we are smoking. Accept any well-formed outcome: a 200 with
    // metadata shape, a 404 (no match), or a 502 (upstream unreachable). A 401/500 would mean
    // the route itself is broken on the deployed instance. A slow/hung upstream is also not a
    // failure of this route, so bound the request and treat a client-side timeout like a 502 —
    // otherwise the external catalog hanging would fail the deploy.
    let res;
    try {
      res = await authed('get', '/api/lookup/isbn/9780262033848').timeout(4000);
    } catch (err) {
      if ((err as { timeout?: number }).timeout !== undefined) return; // upstream too slow — not our route
      throw err;
    }
    expect([200, 404, 502]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toEqual(expect.objectContaining({ title: expect.any(String) }));
    }
  });
});
