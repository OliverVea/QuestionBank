import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { FakeProvider } from '../llm/fake-provider.js';
import { ImageStore } from '../storage/images.js';
import { Store } from '../storage/store.js';

let dir: string;
let app: Awaited<ReturnType<typeof createApp>>;
let questionId: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-practice-'));
  const store = await Store.open(dir);
  app = createApp(store, new FakeProvider(), new ImageStore(dir));
  const bookId = (await request(app).post('/api/books').send({ title: 'B' })).body.id;
  const chapterId = (await request(app).post(`/api/books/${bookId}/chapters`).send({ title: 'C' }))
    .body.id;
  questionId = (
    await request(app).post(`/api/chapters/${chapterId}/questions`).send({ canonicalText: 'q' })
  ).body.id;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Post an attempt with a given rating through the route; it is stamped at "now". */
async function postAttempt(rating: string): Promise<void> {
  await request(app)
    .post(`/api/questions/${questionId}/attempts`)
    .send({
      imagePaths: [],
      answerText: 'a',
      transcription: '',
      recommendedGrade: rating,
      rating,
      issues: [],
    });
}

describe('GET /api/practice/due', () => {
  it('a never-attempted question is not in the due queue', async () => {
    const res = await request(app).get('/api/practice/due');
    expect(res.status).toEqual(200);
    expect(res.body).toEqual([]);
  });

  it('a freshly-attempted question is NOT due yet (next review is in the future)', async () => {
    await postAttempt('correct');
    const res = await request(app).get('/api/practice/due');
    // Attempt was created at "now"; step 1 pushes the next review +7d, so nothing is due now.
    expect(res.body).toEqual([]);
  });

  it('a just-failed question is also not immediately due (re-dues +7d, not now)', async () => {
    // The route always stamps attempts at "now", so even a step-0 (incorrect) attempt
    // re-dues a week out. The *due* path (overdue items surfacing) is covered by
    // srs.test.ts (schedule math) + due-queue logic; here we confirm wiring and the
    // not-due filter. No fake clock plumbing by design.
    await postAttempt('incorrect');
    const res = await request(app).get('/api/practice/due');
    expect(res.status).toEqual(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toEqual([]);
  });
});
