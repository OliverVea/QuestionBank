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
let bookId: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-chapters-'));
  const store = await Store.open(dir);
  app = createApp(store, new FakeProvider(), new ImageStore(dir));
  bookId = (await request(app).post('/api/books').send({ title: 'Book' })).body.id;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('chapters routes', () => {
  it('creates a chapter under a book with an auto-incremented order', async () => {
    const first = await request(app)
      .post(`/api/books/${bookId}/chapters`)
      .send({ title: 'Intro' });
    expect(first.status).toEqual(201);
    expect(first.body).toMatchObject({ bookId, title: 'Intro', order: 0 });

    const second = await request(app)
      .post(`/api/books/${bookId}/chapters`)
      .send({ title: 'Limits' });
    expect(second.body.order).toEqual(1);
  });

  it('lists chapters for a book ordered by order', async () => {
    await request(app).post(`/api/books/${bookId}/chapters`).send({ title: 'A' });
    await request(app).post(`/api/books/${bookId}/chapters`).send({ title: 'B' });
    const list = await request(app).get(`/api/books/${bookId}/chapters`);
    expect(list.status).toEqual(200);
    expect(list.body.map((c: { title: string }) => c.title)).toEqual(['A', 'B']);
  });

  it('rejects creating a chapter under an unknown book with 404', async () => {
    const res = await request(app).post('/api/books/nope/chapters').send({ title: 'X' });
    expect(res.status).toEqual(404);
  });

  it('PATCH and DELETE a chapter by id', async () => {
    const ch = (await request(app).post(`/api/books/${bookId}/chapters`).send({ title: 'A' })).body;
    const patched = await request(app)
      .patch(`/api/chapters/${ch.id}`)
      .send({ description: 'covers basics' });
    expect(patched.body.description).toEqual('covers basics');

    const del = await request(app).delete(`/api/chapters/${ch.id}`);
    expect(del.status).toEqual(204);
    const list = await request(app).get(`/api/books/${bookId}/chapters`);
    expect(list.body).toHaveLength(0);
  });
});
