import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../index.js';
import { FakeProvider } from '../llm/fake-provider.js';
import { Store } from '../storage/store.js';

let dir: string;
let store: Store;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-figures-'));
  store = await Store.open(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function app(): ReturnType<typeof createApp> {
  return createApp(store, new FakeProvider(), null);
}

async function seedQuestion(a: ReturnType<typeof createApp>): Promise<{ bookId: string; questionId: string }> {
  const book = await request(a).post('/api/books').send({ title: 'Calc' });
  const saved = await request(a)
    .put(`/api/books/${book.body.id}/questions`)
    .send({ questions: [{ label: '1.A.1', canonicalText: 'q' }] });
  return { bookId: book.body.id, questionId: saved.body[0].id };
}

async function webp(): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .webp()
    .toBuffer();
}

describe('figure CRUD', () => {
  it('creates, lists, serves, and deletes a figure crop', async () => {
    const a = app();
    const { questionId } = await seedQuestion(a);
    const crop = await webp();

    const created = await request(a)
      .post(`/api/questions/${questionId}/figures`)
      .field('printedLabel', 'Figure 1')
      .field('confidence', 'high')
      .attach('crop', crop, { filename: 'c.webp', contentType: 'image/webp' });
    expect(created.status).toEqual(201);
    expect(created.body.id).toBeTruthy();
    expect(created.body.url).toEqual(`/api/figures/${created.body.id}/image`);
    expect(created.body.printedLabel).toEqual('Figure 1');
    expect(created.body.confidence).toEqual('high');

    const list = await request(a).get(`/api/questions/${questionId}/figures`);
    expect(list.status).toEqual(200);
    expect(list.body).toHaveLength(1);

    const img = await request(a).get(`/api/figures/${created.body.id}/image`);
    expect(img.status).toEqual(200);
    expect(img.headers['content-type']).toContain('image/webp');
    expect(img.headers['cache-control']).toContain('private');

    const del = await request(a).delete(`/api/questions/${questionId}/figures/${created.body.id}`);
    expect(del.status).toEqual(204);
    const after = await request(a).get(`/api/questions/${questionId}/figures`);
    expect(after.body).toHaveLength(0);
    // The crop is gone too → 404 on serve.
    const gone = await request(a).get(`/api/figures/${created.body.id}/image`);
    expect(gone.status).toEqual(404);
  });

  it('drops a bad confidence instead of failing the upload', async () => {
    const a = app();
    const { questionId } = await seedQuestion(a);
    const created = await request(a)
      .post(`/api/questions/${questionId}/figures`)
      .field('confidence', 'bogus')
      .attach('crop', await webp(), { filename: 'c.webp', contentType: 'image/webp' });
    expect(created.status).toEqual(201);
    expect(created.body.confidence).toBeUndefined();
  });

  it('rejects a non-webp crop (400)', async () => {
    const a = app();
    const { questionId } = await seedQuestion(a);
    const res = await request(a)
      .post(`/api/questions/${questionId}/figures`)
      .attach('crop', Buffer.from('x'), { filename: 'c.png', contentType: 'image/png' });
    expect(res.status).toEqual(400);
  });

  it('rolls back the blob (no orphan) when the row create fails after the write', async () => {
    const a = app();
    const { questionId } = await seedQuestion(a);
    // Force the row write to fail AFTER the blob is already on disk.
    vi.spyOn(store.figures, 'create').mockRejectedValueOnce(new Error('disk full'));

    const res = await request(a)
      .post(`/api/questions/${questionId}/figures`)
      .attach('crop', await webp(), { filename: 'c.webp', contentType: 'image/webp' });
    expect(res.status).toEqual(500);

    // The orphan-blob rollback deleted the just-written crop — imgs/ stays empty.
    const blobs = await readdir(join(dir, 'imgs')).catch(() => []);
    expect(blobs).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it('404s posting to a question owned by another customer', async () => {
    const a = app();
    const { questionId } = await seedQuestion(a);
    const res = await request(a)
      .post(`/api/questions/${questionId}/figures`)
      .set('X-Customer-Id', 'someone-else')
      .attach('crop', await webp(), { filename: 'c.webp', contentType: 'image/webp' });
    expect(res.status).toEqual(404);
  });

  it('rejects a malformed / traversal figId with 400 (no FS touch)', async () => {
    const a = app();
    const bad = await request(a).get('/api/figures/not-a-uuid/image');
    expect(bad.status).toEqual(400);
    const traversal = await request(a).get('/api/figures/..%2F..%2Fbooks/image');
    expect(traversal.status).toEqual(400);
  });

  it('404s serving another customer\'s crop', async () => {
    const a = app();
    const { questionId } = await seedQuestion(a);
    const created = await request(a)
      .post(`/api/questions/${questionId}/figures`)
      .attach('crop', await webp(), { filename: 'c.webp', contentType: 'image/webp' });
    const otherOwner = await request(a)
      .get(`/api/figures/${created.body.id}/image`)
      .set('X-Customer-Id', 'someone-else');
    expect(otherOwner.status).toEqual(404);
  });
});

describe('figure cascade', () => {
  it('drops figures + blobs when the book is deleted', async () => {
    const a = app();
    const { bookId, questionId } = await seedQuestion(a);
    const created = await request(a)
      .post(`/api/questions/${questionId}/figures`)
      .attach('crop', await webp(), { filename: 'c.webp', contentType: 'image/webp' });
    const figId = created.body.id;

    await request(a).delete(`/api/books/${bookId}`).expect(204);

    expect(await store.figures.getById('local', figId)).toBeUndefined();
    const gone = await request(a).get(`/api/figures/${figId}/image`);
    expect(gone.status).toEqual(404);
  });

  it('drops figures when a question is removed via batch save', async () => {
    const a = app();
    const { bookId, questionId } = await seedQuestion(a);
    const created = await request(a)
      .post(`/api/questions/${questionId}/figures`)
      .attach('crop', await webp(), { filename: 'c.webp', contentType: 'image/webp' });
    const figId = created.body.id;

    // Re-save the book with an empty question list → the seeded question is deleted.
    await request(a).put(`/api/books/${bookId}/questions`).send({ questions: [] }).expect(200);

    expect(await store.figures.getById('local', figId)).toBeUndefined();
  });
});
