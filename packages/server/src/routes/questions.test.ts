import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { Store } from '../storage/store.js';

let dir: string;
let app: Awaited<ReturnType<typeof createApp>>;
let chapterId: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-questions-'));
  const store = await Store.open(dir);
  app = createApp(store);
  const bookId = (await request(app).post('/api/books').send({ title: 'Book' })).body.id;
  chapterId = (await request(app).post(`/api/books/${bookId}/chapters`).send({ title: 'Ch' })).body
    .id;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('questions routes', () => {
  it('creates a manual question with a text source derived from canonicalText', async () => {
    const res = await request(app)
      .post(`/api/chapters/${chapterId}/questions`)
      .send({ canonicalText: '\\int x\\,dx', label: '2.4' });
    expect(res.status).toEqual(201);
    expect(res.body).toMatchObject({
      chapterId,
      canonicalText: '\\int x\\,dx',
      label: '2.4',
      source: { kind: 'text', rawText: '\\int x\\,dx' },
    });
  });

  it('rejects a question with empty canonicalText (400)', async () => {
    const res = await request(app).post(`/api/chapters/${chapterId}/questions`).send({ label: '1' });
    expect(res.status).toEqual(400);
  });

  it('rejects creation under an unknown chapter (404)', async () => {
    const res = await request(app)
      .post('/api/chapters/nope/questions')
      .send({ canonicalText: 'x' });
    expect(res.status).toEqual(404);
  });

  it('lists questions for a chapter', async () => {
    await request(app).post(`/api/chapters/${chapterId}/questions`).send({ canonicalText: 'a' });
    await request(app).post(`/api/chapters/${chapterId}/questions`).send({ canonicalText: 'b' });
    const list = await request(app).get(`/api/chapters/${chapterId}/questions`);
    expect(list.status).toEqual(200);
    expect(list.body).toHaveLength(2);
  });

  it('PATCH edits canonicalText and label; DELETE removes it', async () => {
    const q = (
      await request(app).post(`/api/chapters/${chapterId}/questions`).send({ canonicalText: 'a' })
    ).body;
    const patched = await request(app)
      .patch(`/api/questions/${q.id}`)
      .send({ canonicalText: 'a + b', label: '3.1' });
    expect(patched.body).toMatchObject({ canonicalText: 'a + b', label: '3.1' });

    const del = await request(app).delete(`/api/questions/${q.id}`);
    expect(del.status).toEqual(204);
    const list = await request(app).get(`/api/chapters/${chapterId}/questions`);
    expect(list.body).toHaveLength(0);
  });
});
