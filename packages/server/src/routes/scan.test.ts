import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { FakeProvider } from '../llm/fake-provider.js';
import { FakeFigureService } from '../services/figure-service-fake.js';
import type { ProcessResult } from '../services/figure-service-client.js';
import { Store } from '../storage/store.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

let dir: string;
let store: Store;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-scan-'));
  store = await Store.open(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function seedBook(app: ReturnType<typeof createApp>): Promise<string> {
  const book = await request(app).post('/api/books').send({ title: 'Calc' });
  return book.body.id as string;
}

/** A real 20×20 white PNG so sharp can decode + extract a crop in the match path. */
async function realPng(): Promise<string> {
  const buf = await sharp({
    create: { width: 20, height: 20, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
  return buf.toString('base64');
}

describe('POST /api/scan', () => {
  it('returns envelope + pages and folds matches back by resolved index', async () => {
    // The fake provider returns the SAME structured object for both the extraction call and
    // the matcher call. The extraction validator reads resolved/needsSection; the matcher
    // validator reads matches — disjoint keys, so one union object serves both.
    const provider = new FakeProvider({
      structured: {
        resolved: [
          { kind: 'add', path: '1.A.1', canonicalText: 'no fig', figureRefs: [] },
          { kind: 'add', path: '1.A.2', canonicalText: 'see fig', figureRefs: ['Figure 1'] },
        ],
        needsSection: [],
        // Matcher: figure 0 → candidate 0 (the only add with refs = resolved index 1).
        matches: [
          { figureIndex: 0, printedLabel: 'Figure 1', matchedProblemIndex: 0, confidence: 'high' },
        ],
      },
    });
    const pngB64 = await realPng();
    const result: ProcessResult = {
      rectified: { pngBase64: pngB64, width: 20, height: 20 },
      figures: [{ id: 0, box: [0, 0, 10, 10], score: 0.9 }],
    };
    const figureService = new FakeFigureService(result);
    const app = createApp(store, provider, figureService);
    const bookId = await seedBook(app);

    const res = await request(app)
      .post('/api/scan')
      .field('bookId', bookId)
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });

    expect(res.status).toEqual(200);
    expect(res.body.envelope.resolved).toHaveLength(2);
    expect(res.body.pages).toHaveLength(1);
    const fig = res.body.pages[0].figures[0];
    // candidate 0 is the resolved add at index 1.
    expect(fig.matchedAddIndex).toEqual(1);
    expect(fig.printedLabel).toEqual('Figure 1');
    expect(res.body.figuresError).toBeUndefined();
    expect(res.body.matchError).toBeUndefined();
  });

  it('downscales the rectified page + crops before the matcher call (10 MB/image limit)', async () => {
    const provider = new FakeProvider({
      structured: {
        resolved: [
          { kind: 'add', path: '1.A.1', canonicalText: 'see fig', figureRefs: ['Figure 1'] },
        ],
        needsSection: [],
        matches: [
          { figureIndex: 0, printedLabel: 'Figure 1', matchedProblemIndex: 0, confidence: 'high' },
        ],
      },
    });
    // An oversized rectified page like the real device emits (3472×4624). Full-res this is
    // ~19 MB base64, over Anthropic's 10 MB/image hard limit — the matcher must downscale it.
    const bigPng = await sharp({
      create: { width: 3472, height: 4624, channels: 3, background: { r: 200, g: 150, b: 100 } },
    })
      .png()
      .toBuffer();
    const figureService = new FakeFigureService({
      rectified: { pngBase64: bigPng.toString('base64'), width: 3472, height: 4624 },
      figures: [{ id: 0, box: [100, 100, 2000, 3000], score: 0.9 }],
    });
    const app = createApp(store, provider, figureService);
    const bookId = await seedBook(app);

    const res = await request(app)
      .post('/api/scan')
      .field('bookId', bookId)
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });

    expect(res.status).toEqual(200);
    expect(res.body.matchError).toBeUndefined();

    // lastConversation is the matcher call (it runs after extraction). Its images are
    // [page, crop] — both must be capped and well under the 10 MB/image limit.
    const images = provider.lastConversation[0]!.images ?? [];
    expect(images).toHaveLength(2);
    for (const ref of images) {
      expect(ref.mimeType).toEqual('image/jpeg');
      const bytes = await ref.load();
      expect(bytes.toString('base64').length).toBeLessThan(10 * 1024 * 1024);
      const meta = await sharp(bytes).metadata();
      expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1568);
    }
  });

  it('skips the matcher when no add cites a figure', async () => {
    const provider = new FakeProvider({
      structured: {
        resolved: [{ kind: 'add', path: '1.A.1', canonicalText: 'x', figureRefs: [] }],
        needsSection: [],
      },
    });
    const pngB64 = await realPng();
    const figureService = new FakeFigureService({
      rectified: { pngBase64: pngB64, width: 20, height: 20 },
      figures: [{ id: 0, box: [0, 0, 10, 10], score: 0.9 }],
    });
    const app = createApp(store, provider, figureService);
    const bookId = await seedBook(app);

    const res = await request(app)
      .post('/api/scan')
      .field('bookId', bookId)
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });

    expect(res.status).toEqual(200);
    // Figure present but unmatched (no matchedAddIndex set).
    expect(res.body.pages[0].figures[0].matchedAddIndex).toBeUndefined();
  });

  it('degrades to figuresError when figure-service throws', async () => {
    const provider = new FakeProvider({
      structured: {
        resolved: [{ kind: 'add', path: '1.A.1', canonicalText: 'see fig', figureRefs: ['Fig 1'] }],
        needsSection: [],
      },
    });
    const figureService = new FakeFigureService();
    figureService.failWith(new Error('service down'));
    const app = createApp(store, provider, figureService);
    const bookId = await seedBook(app);

    const res = await request(app)
      .post('/api/scan')
      .field('bookId', bookId)
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });

    expect(res.status).toEqual(200);
    expect(res.body.figuresError).toEqual(true);
    expect(res.body.pages).toEqual([]);
    // Problems still come back.
    expect(res.body.envelope.resolved).toHaveLength(1);
  });

  it('runs extraction-only with figuresError when no figure-service is configured', async () => {
    const provider = new FakeProvider({
      structured: {
        resolved: [{ kind: 'add', path: '1.A.1', canonicalText: 'x', figureRefs: [] }],
        needsSection: [],
      },
    });
    const app = createApp(store, provider, null);
    const bookId = await seedBook(app);
    const res = await request(app)
      .post('/api/scan')
      .field('bookId', bookId)
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });
    expect(res.status).toEqual(200);
    expect(res.body.figuresError).toEqual(true);
  });

  it('returns 502 when extraction fails', async () => {
    const provider = new FakeProvider();
    provider.failWith(new (await import('../llm/provider.js')).LlmError('boom'));
    const app = createApp(store, provider, new FakeFigureService());
    const bookId = await seedBook(app);
    const res = await request(app)
      .post('/api/scan')
      .field('bookId', bookId)
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });
    expect(res.status).toEqual(502);
  });

  it('rejects a missing bookId (400) and unknown book (404)', async () => {
    const app = createApp(store, new FakeProvider(), new FakeFigureService());
    const noBook = await request(app)
      .post('/api/scan')
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });
    expect(noBook.status).toEqual(400);

    const ghost = await request(app)
      .post('/api/scan')
      .field('bookId', 'ghost')
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });
    expect(ghost.status).toEqual(404);
  });
});
