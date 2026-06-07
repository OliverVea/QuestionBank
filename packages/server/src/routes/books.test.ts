import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { Store } from '../storage/store.js';

let dir: string;
let app: Awaited<ReturnType<typeof createApp>>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-books-'));
  const store = await Store.open(dir);
  app = createApp(store);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('books routes', () => {
  it('POST creates a book and GET lists it', async () => {
    const post = await request(app).post('/api/books').send({ title: 'Calculus' });
    expect(post.status).toEqual(201);
    expect(post.body).toMatchObject({ title: 'Calculus' });
    expect(post.body.id).toBeTruthy();
    expect(post.body.createdAt).toBeTruthy();

    const list = await request(app).get('/api/books');
    expect(list.status).toEqual(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].title).toEqual('Calculus');
  });

  it('POST rejects a missing title with 400', async () => {
    const res = await request(app).post('/api/books').send({ author: 'nobody' });
    expect(res.status).toEqual(400);
  });

  it('GET :id returns one book, 404 when unknown', async () => {
    const created = (await request(app).post('/api/books').send({ title: 'Physics' })).body;
    const ok = await request(app).get(`/api/books/${created.id}`);
    expect(ok.status).toEqual(200);
    expect(ok.body.title).toEqual('Physics');

    const missing = await request(app).get('/api/books/does-not-exist');
    expect(missing.status).toEqual(404);
  });

  it('PATCH updates fields', async () => {
    const created = (await request(app).post('/api/books').send({ title: 'Physics' })).body;
    const patched = await request(app)
      .patch(`/api/books/${created.id}`)
      .send({ author: 'Feynman', learningGoal: 'intuition' });
    expect(patched.status).toEqual(200);
    expect(patched.body).toMatchObject({ author: 'Feynman', learningGoal: 'intuition' });
  });

  it('DELETE removes a book', async () => {
    const created = (await request(app).post('/api/books').send({ title: 'Physics' })).body;
    const del = await request(app).delete(`/api/books/${created.id}`);
    expect(del.status).toEqual(204);
    const list = await request(app).get('/api/books');
    expect(list.body).toHaveLength(0);
  });

  it('GET :id/tree returns the book with nested chapters and questions', async () => {
    const bookId = (await request(app).post('/api/books').send({ title: 'Tree' })).body.id;
    const chapterId = (
      await request(app).post(`/api/books/${bookId}/chapters`).send({ title: 'Ch' })
    ).body.id;
    await request(app).post(`/api/chapters/${chapterId}/questions`).send({ canonicalText: 'x' });

    const res = await request(app).get(`/api/books/${bookId}/tree`);
    expect(res.status).toEqual(200);
    expect(res.body.chapters).toHaveLength(1);
    expect(res.body.chapters[0].questions).toHaveLength(1);
  });
});
