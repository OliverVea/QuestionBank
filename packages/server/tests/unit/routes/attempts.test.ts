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
  dir = await mkdtemp(join(tmpdir(), 'qb-attempts-'));
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

const body = {
  imagePaths: ['images/a.jpg'],
  answerText: '',
  transcription: 'z^3 = 1',
  recommendedGrade: 'partial',
  rating: 'correct',
  issues: [{ severity: 'medium', description: 'sign error in step 2' }],
};

describe('attempts routes', () => {
  it('un-attempted question lists empty', async () => {
    const res = await request(app).get(`/api/questions/${questionId}/attempts`);
    expect(res.status).toEqual(200);
    expect(res.body).toEqual([]);
  });

  it('creates an attempt (201) and lists it', async () => {
    const created = await request(app).post(`/api/questions/${questionId}/attempts`).send(body);
    expect(created.status).toEqual(201);
    expect(created.body).toMatchObject({
      questionId,
      rating: 'correct',
      recommendedGrade: 'partial',
      imagePaths: ['images/a.jpg'],
      transcription: 'z^3 = 1',
    });
    expect(created.body.id).toBeTruthy();
    const list = await request(app).get(`/api/questions/${questionId}/attempts`);
    expect(list.body).toHaveLength(1);
  });

  it('accepts a typed-only attempt (answerText, no photos)', async () => {
    const res = await request(app)
      .post(`/api/questions/${questionId}/attempts`)
      .send({ ...body, imagePaths: [], answerText: 'my typed answer', transcription: '' });
    expect(res.status).toEqual(201);
  });

  it('404 when the question does not exist', async () => {
    const res = await request(app).post('/api/questions/nope/attempts').send(body);
    expect(res.status).toEqual(404);
  });

  it('400 when neither photo nor typed answer is present', async () => {
    const res = await request(app)
      .post(`/api/questions/${questionId}/attempts`)
      .send({ ...body, imagePaths: [], answerText: '' });
    expect(res.status).toEqual(400);
  });

  it('400 on an invalid grade value', async () => {
    const res = await request(app)
      .post(`/api/questions/${questionId}/attempts`)
      .send({ ...body, rating: 'amazing' });
    expect(res.status).toEqual(400);
  });
});
