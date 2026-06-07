import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { FakeProvider } from '../llm/fake-provider.js';
import { LlmError } from '../llm/provider.js';
import { ImageStore } from '../storage/images.js';
import { Store } from '../storage/store.js';

let dir: string;
let provider: FakeProvider;
let imageStore: ImageStore;
let app: Awaited<ReturnType<typeof createApp>>;
let chapterId: string;

async function setup(p: FakeProvider): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), 'qb-extract-'));
  const store = await Store.open(dir);
  provider = p;
  imageStore = new ImageStore(dir);
  app = createApp(store, provider, imageStore);
  const bookId = (await request(app).post('/api/books').send({ title: 'Book' })).body.id;
  chapterId = (await request(app).post(`/api/books/${bookId}/chapters`).send({ title: 'Ch' })).body
    .id;
}

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('POST /api/chapters/:chapterId/questions/extract', () => {
  it('stores the image and creates image-sourced questions, returning 201', async () => {
    await setup(
      new FakeProvider([
        { canonicalText: '\\int x\\,dx', label: '2.4' },
        { canonicalText: 'Prove it.' },
      ]),
    );

    const res = await request(app)
      .post(`/api/chapters/${chapterId}/questions/extract`)
      .attach('image', Buffer.from('fake-png'), { filename: 'page.png', contentType: 'image/png' });

    expect(res.status).toEqual(201);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({
      chapterId,
      canonicalText: '\\int x\\,dx',
      label: '2.4',
      source: { kind: 'image' },
    });
    expect(res.body[0].source.imagePath).toMatch(/images/);

    const files = await readdir(join(dir, 'images'));
    expect(files).toHaveLength(1);

    const list = await request(app).get(`/api/chapters/${chapterId}/questions`);
    expect(list.body).toHaveLength(2);
  });

  it('returns 201 with an empty array when the LLM finds no questions', async () => {
    await setup(new FakeProvider([]));
    const res = await request(app)
      .post(`/api/chapters/${chapterId}/questions/extract`)
      .attach('image', Buffer.from('fake-png'), { filename: 'page.png', contentType: 'image/png' });
    expect(res.status).toEqual(201);
    expect(res.body).toEqual([]);
  });

  it('returns 404 when the chapter does not exist', async () => {
    await setup(new FakeProvider());
    const res = await request(app)
      .post('/api/chapters/nope/questions/extract')
      .attach('image', Buffer.from('fake-png'), { filename: 'page.png', contentType: 'image/png' });
    expect(res.status).toEqual(404);
  });

  it('returns 400 when no image is uploaded', async () => {
    await setup(new FakeProvider());
    const res = await request(app).post(`/api/chapters/${chapterId}/questions/extract`).send();
    expect(res.status).toEqual(400);
  });

  it('returns 400 when the upload is not an image', async () => {
    await setup(new FakeProvider());
    const res = await request(app)
      .post(`/api/chapters/${chapterId}/questions/extract`)
      .attach('image', Buffer.from('not-an-image'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toEqual(400);
  });

  it('returns 502 when the provider fails', async () => {
    const failing = new FakeProvider();
    failing.failWith(new LlmError('cli exploded'));
    await setup(failing);
    const res = await request(app)
      .post(`/api/chapters/${chapterId}/questions/extract`)
      .attach('image', Buffer.from('fake-png'), { filename: 'page.png', contentType: 'image/png' });
    expect(res.status).toEqual(502);
  });
});
