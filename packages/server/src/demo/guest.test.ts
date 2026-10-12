import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { Store } from '../storage/store.js';
import { DemoProvider } from './demo-provider.js';
import { createDemoVerifier } from './guest.js';

const ALICE = 'demo-11111111-1111-4111-8111-111111111111';
const BOB = 'demo-22222222-2222-4222-8222-222222222222';

let dir: string;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-demo-'));
  const store = await Store.open(dir);
  app = createApp(store, new DemoProvider(), null, createDemoVerifier(store), 'demo');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const as = (guest: string) => ({ Authorization: `Bearer ${guest}` });

describe('demo mode', () => {
  it('health announces the demo so the client can skip the login', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body).toEqual({ status: 'ok', mode: 'demo' });
  });

  it('rejects a request without a guest token', async () => {
    expect((await request(app).get('/api/books')).status).toEqual(401);
    expect((await request(app).get('/api/books').set({ Authorization: 'Bearer alice' })).status).toEqual(401);
  });

  it('gives a new guest the sample library, with figures that load', async () => {
    const books = (await request(app).get('/api/books').set(as(ALICE))).body as { id: string; title: string; questionIds: string[] }[];
    expect(books.map((b) => b.title).sort()).toEqual(['Forces and Motion', 'Techniques of Integration']);
    const forces = books.find((b) => b.title === 'Forces and Motion')!;
    expect(forces.questionIds).toHaveLength(14);
    const figures = (await request(app).get(`/api/questions/${forces.questionIds[0]}/figures`).set(as(ALICE))).body as { url: string }[];
    expect(figures).toHaveLength(1);
    const image = await request(app).get(figures[0]!.url).set(as(ALICE));
    expect(image.status).toEqual(200);
    expect(image.headers['content-type']).toEqual('image/webp');
  });

  it('keeps guests apart: one guest\'s change is invisible to another', async () => {
    const mine = (await request(app).get('/api/books').set(as(ALICE))).body as { id: string }[];
    await request(app).delete(`/api/books/${mine[0]!.id}`).set(as(ALICE)).expect(204);
    expect((await request(app).get('/api/books').set(as(ALICE))).body).toHaveLength(1);
    expect((await request(app).get('/api/books').set(as(BOB))).body).toHaveLength(2);
    expect((await request(app).get(`/api/books/${mine[1]!.id}`).set(as(BOB))).status).toEqual(404);
  });

  it('fails a model call without reaching any backend', async () => {
    const books = (await request(app).get('/api/books').set(as(ALICE))).body as { questionIds: string[] }[];
    const res = await request(app)
      .post(`/api/questions/${books[0]!.questionIds[0]}/grade`)
      .set(as(ALICE))
      .send({ conversation: [{ role: 'user', text: 'x = 1' }] });
    expect(res.status).toEqual(502);
  });
});
