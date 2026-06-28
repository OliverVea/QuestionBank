import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { FakeProvider } from '../llm/fake-provider.js';
import { fakeVerifier } from '../test-support/auth.js';
import { Store } from '../storage/store.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

let dir: string;
let store: Store;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-extract-'));
  store = await Store.open(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Create a book and one problem, returning their ids. */
async function seedBook(app: ReturnType<typeof createApp>): Promise<{ bookId: string; questionId: string }> {
  const book = await request(app).post('/api/books').send({ title: 'Calc' });
  const saved = await request(app)
    .put(`/api/books/${book.body.id}/questions`)
    .send({ questions: [{ label: '1.A.1', canonicalText: 'Differentiate x^2' }] });
  return { bookId: book.body.id, questionId: saved.body[0].id };
}

describe('POST /api/extract (multi-page)', () => {
  it('passes existing problems into the provider and returns resolved + needsSection', async () => {
    const provider = new FakeProvider();
    const app = createApp(store, provider, undefined, fakeVerifier());
    const { bookId, questionId } = await seedBook(app);

    // Script the model: skip the known problem, add a new one, flag one ambiguous page.
    provider['config'] = {
      structured: {
        resolved: [
          { kind: 'skip', canonicalText: 'Differentiate x^2', targetId: questionId },
          { kind: 'add', path: '1.A.2', canonicalText: 'Integrate 2x' },
        ],
        needsSection: [{ pageIndex: 1, problems: [{ localLabel: '4', canonicalText: 'bare four' }] }],
      },
    };

    const res = await request(app)
      .post('/api/extract')
      .field('bookId', bookId)
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' })
      .attach('images', PNG, { filename: 'p2.png', contentType: 'image/png' });

    expect(res.status).toEqual(200);
    expect(res.body.resolved).toHaveLength(2);
    expect(res.body.needsSection[0].pageIndex).toEqual(1);

    // The existing problem (id|path|text) reached the model's prompt.
    const sent = provider.lastConversation[0];
    expect(sent.images).toHaveLength(2);
    expect(sent.text).toContain(questionId);
    expect(sent.text).toContain('1.A.1');
  });

  it('rejects a request with no images (400)', async () => {
    const app = createApp(store, new FakeProvider(), undefined, fakeVerifier());
    const { bookId } = await seedBook(app);
    const res = await request(app).post('/api/extract').field('bookId', bookId);
    expect(res.status).toEqual(400);
  });

  it('rejects a missing bookId (400)', async () => {
    const app = createApp(store, new FakeProvider(), undefined, fakeVerifier());
    const res = await request(app)
      .post('/api/extract')
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });
    expect(res.status).toEqual(400);
  });

  it('rejects an unknown book (404)', async () => {
    const app = createApp(store, new FakeProvider(), undefined, fakeVerifier());
    const res = await request(app)
      .post('/api/extract')
      .field('bookId', 'ghost')
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });
    expect(res.status).toEqual(404);
  });

  it('rejects a 6th image (400)', async () => {
    const app = createApp(store, new FakeProvider(), undefined, fakeVerifier());
    const { bookId } = await seedBook(app);
    let req = request(app).post('/api/extract').field('bookId', bookId);
    for (let i = 0; i < 6; i++) {
      req = req.attach('images', PNG, { filename: `p${i}.png`, contentType: 'image/png' });
    }
    const res = await req;
    expect(res.status).toEqual(400);
  });

  it('returns 502 when the model emits a cross-field-invalid delta', async () => {
    const provider = new FakeProvider({
      structured: { resolved: [{ kind: 'edit', path: '1.A.1', canonicalText: 'x' }], needsSection: [] },
    });
    const app = createApp(store, provider, undefined, fakeVerifier());
    const { bookId } = await seedBook(app);
    const res = await request(app)
      .post('/api/extract')
      .field('bookId', bookId)
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });
    expect(res.status).toEqual(502);
  });

  it('asks for relevance only when the book has a learningGoal, and carries it through', async () => {
    const provider = new FakeProvider({
      structured: {
        resolved: [{ kind: 'add', path: '1.A.1', canonicalText: 'q', relevance: 'high' }],
        needsSection: [],
      },
    });
    const app = createApp(store, provider, undefined, fakeVerifier());

    // A goal-bearing book: the prompt includes the relevance instruction and the result keeps it.
    const goalBook = await request(app).post('/api/books').send({ title: 'Calc', learningGoal: 'master derivatives' });
    const withGoal = await request(app)
      .post('/api/extract')
      .field('bookId', goalBook.body.id)
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });
    expect(withGoal.status).toEqual(200);
    expect(provider.lastConversation[0].text).toContain('master derivatives');
    expect(withGoal.body.resolved[0].relevance).toEqual('high');

    // A goal-less book: the prompt omits relevance scoring entirely.
    const plainBook = await request(app).post('/api/books').send({ title: 'NoGoal' });
    await request(app)
      .post('/api/extract')
      .field('bookId', plainBook.body.id)
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });
    expect(provider.lastConversation[0].text).not.toContain('learning goal for this book');
  });
});

describe('POST /api/extract/refine', () => {
  it('builds a user→assistant→user transcript carrying the section answers, returns the envelope', async () => {
    const provider = new FakeProvider({
      structured: {
        resolved: [{ kind: 'add', path: '1.A.4', canonicalText: 'Integrate 4x' }],
        needsSection: [],
      },
    });
    const app = createApp(store, provider, undefined, fakeVerifier());
    const { bookId } = await seedBook(app);

    const prior = {
      resolved: [],
      needsSection: [{ pageIndex: 1, problems: [{ localLabel: '4', canonicalText: 'Integrate 4x' }] }],
    };
    const res = await request(app)
      .post('/api/extract/refine')
      .field('bookId', bookId)
      .field('currentExtraction', JSON.stringify(prior))
      .field('sectionAnswers', JSON.stringify({ '1': '1.A' }))
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' })
      .attach('images', PNG, { filename: 'p2.png', contentType: 'image/png' });

    expect(res.status).toEqual(200);
    expect(res.body.needsSection).toEqual([]);
    expect(res.body.resolved[0].path).toEqual('1.A.4');

    // Transcript: user(prompt+images) → assistant(prior envelope JSON) → user(correction).
    const convo = provider.lastConversation;
    expect(convo.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(convo[0].images).toHaveLength(2);
    expect(convo[1].text).toContain('needsSection');
    // The user's section answer is stated in the correction turn.
    expect(convo[2].text).toContain('1.A');
  });

  it('rejects refine with a missing bookId (400)', async () => {
    const app = createApp(store, new FakeProvider(), undefined, fakeVerifier());
    const res = await request(app)
      .post('/api/extract/refine')
      .field('sectionAnswers', JSON.stringify({ '1': '1.A' }))
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });
    expect(res.status).toEqual(400);
  });
});
