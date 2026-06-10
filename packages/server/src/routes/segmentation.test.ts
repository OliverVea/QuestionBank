import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { FakeProvider } from '../llm/fake-provider.js';
import type { ResolveCustomerConfig } from '../middleware/resolve-customer.js';
import { ImageStore } from '../storage/images.js';
import { Store } from '../storage/store.js';

// Resolve the customer from the X-Customer-Id header (no default fallback) so each request
// acts as a specific customer and we can prove A never sees B's data.
const CONFIG: ResolveCustomerConfig = {
  customerHeader: 'X-Customer-Id',
  allowDefaultCustomer: false,
  proxySecretHeader: 'X-Proxy-Secret',
};

const A = 'alice';
const B = 'bob';

let dir: string;
let app: Awaited<ReturnType<typeof createApp>>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-seg-'));
  const store = await Store.open(dir);
  app = createApp(store, new FakeProvider(), new ImageStore(dir), CONFIG);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Build a book → chapter → question → attempt chain owned by `customer`; return their ids. */
async function seedChain(customer: string) {
  const as = (r: request.Test) => r.set('X-Customer-Id', customer);
  const bookId = (await as(request(app).post('/api/books').send({ title: 'Book' }))).body.id;
  const chapterId = (
    await as(request(app).post(`/api/books/${bookId}/chapters`).send({ title: 'Ch' }))
  ).body.id;
  const questionId = (
    await as(request(app).post(`/api/chapters/${chapterId}/questions`).send({ canonicalText: 'q' }))
  ).body.id;
  await as(
    request(app)
      .post(`/api/questions/${questionId}/attempts`)
      .send({
        imagePaths: [],
        answerText: 'a',
        transcription: '',
        recommendedGrade: 'correct',
        rating: 'correct',
        issues: [],
      }),
  );
  return { bookId, chapterId, questionId };
}

describe('customer segmentation', () => {
  it('lists only the requesting customer\'s books', async () => {
    await seedChain(A);
    await seedChain(B);

    const aBooks = await request(app).get('/api/books').set('X-Customer-Id', A);
    expect(aBooks.body).toHaveLength(1);
    const bBooks = await request(app).get('/api/books').set('X-Customer-Id', B);
    expect(bBooks.body).toHaveLength(1);
    expect(aBooks.body[0].id).not.toEqual(bBooks.body[0].id);
  });

  it('A cannot read, patch, or delete B\'s book (wrong-owner is 404)', async () => {
    const { bookId } = await seedChain(B);

    const read = await request(app).get(`/api/books/${bookId}`).set('X-Customer-Id', A);
    expect(read.status).toEqual(404);

    const patch = await request(app)
      .patch(`/api/books/${bookId}`)
      .set('X-Customer-Id', A)
      .send({ title: 'hijacked' });
    expect(patch.status).toEqual(404);

    const del = await request(app).delete(`/api/books/${bookId}`).set('X-Customer-Id', A);
    expect(del.status).toEqual(204); // delete is idempotent, but...

    // ...B's book is untouched.
    const stillThere = await request(app).get(`/api/books/${bookId}`).set('X-Customer-Id', B);
    expect(stillThere.status).toEqual(200);
    expect(stillThere.body.title).toEqual('Book');
  });

  it('A cannot see B\'s book tree, chapters, or questions', async () => {
    const { bookId, chapterId } = await seedChain(B);

    const tree = await request(app).get(`/api/books/${bookId}/tree`).set('X-Customer-Id', A);
    expect(tree.status).toEqual(404);

    const chapters = await request(app)
      .get(`/api/books/${bookId}/chapters`)
      .set('X-Customer-Id', A);
    expect(chapters.body).toEqual([]);

    const questions = await request(app)
      .get(`/api/chapters/${chapterId}/questions`)
      .set('X-Customer-Id', A);
    expect(questions.body).toEqual([]);
  });

  it('A cannot read or patch B\'s question, nor list/create its attempts', async () => {
    const { questionId } = await seedChain(B);

    const patch = await request(app)
      .patch(`/api/questions/${questionId}`)
      .set('X-Customer-Id', A)
      .send({ canonicalText: 'x' });
    expect(patch.status).toEqual(404);

    const attempts = await request(app)
      .get(`/api/questions/${questionId}/attempts`)
      .set('X-Customer-Id', A);
    expect(attempts.status).toEqual(404); // question not found for A

    const post = await request(app)
      .post(`/api/questions/${questionId}/attempts`)
      .set('X-Customer-Id', A)
      .send({ imagePaths: [], answerText: 'a', recommendedGrade: 'correct', rating: 'correct' });
    expect(post.status).toEqual(404);
  });

  it('learn-next and due-queue are scoped to the requesting customer', async () => {
    // B has an attempted question; A has a fresh un-attempted one.
    await seedChain(B);
    const aBookId = (
      await request(app).post('/api/books').set('X-Customer-Id', A).send({ title: 'A-Book' })
    ).body.id;
    const aChapterId = (
      await request(app)
        .post(`/api/books/${aBookId}/chapters`)
        .set('X-Customer-Id', A)
        .send({ title: 'A-Ch' })
    ).body.id;
    await request(app)
      .post(`/api/chapters/${aChapterId}/questions`)
      .set('X-Customer-Id', A)
      .send({ canonicalText: 'a-q' });

    // A's learn-next surfaces A's question, never B's.
    const aNext = await request(app).get('/api/learn/next').set('X-Customer-Id', A);
    expect(aNext.body.question?.canonicalText).toEqual('a-q');

    // A's due queue is empty (A has no attempts); B's seeded attempt never leaks to A.
    const aDue = await request(app).get('/api/practice/due').set('X-Customer-Id', A);
    expect(aDue.body).toEqual([]);
  });
});
