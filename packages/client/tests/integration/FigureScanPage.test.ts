import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { FigureScanPage } from '@/pages/FigureScanPage';
import { stashPhotos } from '@/lib/photo-transfer';

// ------------------------------------------------------------------ harness
//
// jsdom neither loads data-URL <img>s nor implements <canvas>, so the page's
// decode-gate (`new Image()` in decodeImg) and crop bake/cut (canvas) need
// stubbing. We replace Image with one whose `src` setter fires onload on the
// next microtask, and give the canvas prototype a no-op 2d context + a toBlob
// that yields a webp blob (so the per-figure POST actually fires).

type FetchCall = { url: string; method: string; init: RequestInit | undefined };

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 1000;
  naturalHeight = 1400;
  private _src = '';
  set src(v: string) {
    this._src = v;
    queueMicrotask(() => this.onload?.());
  }
  get src(): string {
    return this._src;
  }
}

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

/** A scan response: two adds (one fully matched, one citing 2 figures but
 *  getting 1 → (!)), an accepted edit onto an existing row, and a skip. */
function scanResponse() {
  return {
    envelope: {
      resolved: [
        { kind: 'add', path: '5.32', canonicalText: 'Problem A', relevance: 'high', figureRefs: ['Figure 5.32'] },
        { kind: 'add', path: '5.33', canonicalText: 'Problem B', relevance: 'medium', figureRefs: ['Figure 5.33', 'Figure 5.34'] },
        { kind: 'edit', targetId: 'q-existing', canonicalText: 'edited text', relevance: 'low' },
        { kind: 'skip', canonicalText: 'a duplicate' },
      ],
      needsSection: [],
    },
    pages: [
      {
        pageIndex: 0,
        rectified: { pngBase64: 'AAAA', width: 1000, height: 1400 },
        figures: [
          { detectionId: 0, box: [10, 10, 100, 100], score: 0.9, matchedAddIndex: 0, printedLabel: 'Figure 5.32', confidence: 'high' },
          { detectionId: 1, box: [10, 200, 100, 300], score: 0.8, matchedAddIndex: 1, printedLabel: 'Figure 5.33', confidence: 'medium' },
          { detectionId: 2, box: [200, 10, 300, 100], score: 0.7, matchedAddIndex: null },
        ],
      },
    ],
    figuresError: false,
  };
}

const existingRow = { id: 'q-existing', label: '1.A.1', canonicalText: 'original', relevance: 'high' as const };

function installFetch(opts: { scan?: object; figuresError?: boolean } = {}): {
  fetchMock: ReturnType<typeof vi.fn>;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const scan = opts.scan ?? scanResponse();
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, init });
    if (url === '/api/scan') return json(scan);
    if (url === '/api/books/b1/questions' && method === 'GET') return json([existingRow]);
    if (url === '/api/books/b1/questions' && method === 'PUT') {
      // Echo incoming order, minting ids for new (id-less) rows — like the server.
      const incoming = JSON.parse(init!.body as string).questions as Array<{ id?: string }>;
      let n = 0;
      return json(incoming.map((q) => ({ id: q.id ?? `new-${++n}` })));
    }
    if (/^\/api\/questions\/[^/]+\/figures$/.test(url) && method === 'POST') return json({ id: 'fig-x' });
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

/** Mount the page, run step 1 → 2 (POST /api/scan) → 3, and resolve once the
 *  step-3 cards have rendered. */
async function mountToStep3(): Promise<HTMLElement> {
  const page = FigureScanPage();
  document.getElementById('app')!.appendChild(page);
  // navNext is "Extract figures" on step 1.
  const next = page.querySelector<HTMLButtonElement>('.fs-actions .primary-btn')!;
  next.click();
  await vi.waitFor(() => {
    const s3 = page.querySelector('.fs-step[data-step="3"]');
    expect(s3?.classList.contains('active')).toBe(true);
    expect(page.querySelector('.fs-q')).not.toBeNull();
  });
  return page;
}

describe('FigureScanPage', () => {
  let getContextStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.location.hash = '#/figure-scan';
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal('Image', FakeImage);
    // URL object-url shims for renderPics (step 1 thumbnails).
    vi.stubGlobal('URL', Object.assign(Object.create(URL), {
      createObjectURL: vi.fn(() => 'blob:fake'),
      revokeObjectURL: vi.fn(),
    }));
    // Canvas shims: cut() uses toDataURL, bakeCrop() uses toBlob.
    getContextStub = vi.fn(() => ({ drawImage: vi.fn() }));
    HTMLCanvasElement.prototype.getContext = getContextStub as never;
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/jpeg;base64,zzz') as never;
    HTMLCanvasElement.prototype.toBlob = vi.fn((cb: BlobCallback) => {
      cb(new Blob(['crop'], { type: 'image/webp' }));
    }) as never;
    // Two photographed pages in the transfer slot.
    stashPhotos({
      files: [new File(['a'], 'p1.jpg', { type: 'image/jpeg' })],
      notes: '',
      bookId: 'b1',
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  test('(!) marks an add whose cited figures were not all attached', async () => {
    installFetch();
    const page = await mountToStep3();

    const cards = [...page.querySelectorAll('.fs-q')];
    // Two add cards rendered (edit also renders, skip is grouped) — find by path label.
    const cardA = cards.find((c) => c.querySelector('.fs-q-label')?.textContent === '5.32')!;
    const cardB = cards.find((c) => c.querySelector('.fs-q-label')?.textContent === '5.33')!;

    // add A cited 1 figure, got 1 → no bang. add B cited 2, got 1 → bang.
    expect(cardA.querySelector('.fs-q-bang')).toBeNull();
    expect(cardB.querySelector('.fs-q-bang')).not.toBeNull();
    // Exactly one bang on the whole page.
    expect(page.querySelectorAll('.fs-q-bang').length).toBe(1);
  });

  test('under figuresError, every add citing a figure flags (!)', async () => {
    const errResp = scanResponse();
    errResp.figuresError = true;
    errResp.pages = []; // figure-service down → no rectified pages, no matches
    installFetch({ scan: errResp });
    const page = await mountToStep3();

    // Both adds cite figures and none could be attached → both flag.
    expect(page.querySelectorAll('.fs-q-bang').length).toBe(2);
  });

  test('commit PUTs the full row list: edit mutated in place, adds appended', async () => {
    const { calls } = installFetch();
    vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const page = await mountToStep3();

    page.querySelector<HTMLButtonElement>('.fs-actions .primary-btn')!.click(); // Continue → commit
    await vi.waitFor(() => expect(calls.some((c) => c.url === '/api/books/b1/questions' && c.method === 'PUT')).toBe(true));

    const put = calls.find((c) => c.url === '/api/books/b1/questions' && c.method === 'PUT')!;
    const body = JSON.parse(put.init!.body as string).questions as Array<Record<string, unknown>>;

    // Three rows: the existing row (mutated by the accepted edit) + two appended adds.
    expect(body.length).toBe(3);
    // Slot 0: existing row kept WITH its id, edited in place.
    expect(body[0]).toMatchObject({ id: 'q-existing', canonicalText: 'edited text', relevance: 'low' });
    // Slots 1 & 2: new adds, NO id, in resolved order.
    expect(body[1]).toMatchObject({ label: '5.32', canonicalText: 'Problem A', relevance: 'high' });
    expect(body[1]!.id).toBeUndefined();
    expect(body[2]).toMatchObject({ label: '5.33', canonicalText: 'Problem B', relevance: 'medium' });
    expect(body[2]!.id).toBeUndefined();
  });

  test('commit resolves new add ids positionally and POSTs each figure to its question', async () => {
    const { calls } = installFetch();
    vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const page = await mountToStep3();

    page.querySelector<HTMLButtonElement>('.fs-actions .primary-btn')!.click();
    await vi.waitFor(() => expect(calls.filter((c) => /\/figures$/.test(c.url) && c.method === 'POST').length).toBe(2));

    const figurePosts = calls.filter((c) => /\/figures$/.test(c.url) && c.method === 'POST');
    // Positional read-back: PUT echoed [q-existing, new-1, new-2]; add A is slot 1 (new-1),
    // add B is slot 2 (new-2). Each gets its one attached figure POSTed.
    const targets = figurePosts.map((c) => c.url);
    expect(targets).toContain('/api/questions/new-1/figures');
    expect(targets).toContain('/api/questions/new-2/figures');

    // Figure metadata is carried on the multipart body.
    const formA = figurePosts.find((c) => c.url === '/api/questions/new-1/figures')!.init!.body as FormData;
    expect(formA.get('printedLabel')).toBe('Figure 5.32');
    expect(formA.get('confidence')).toBe('high');
    expect(formA.get('crop')).toBeInstanceOf(Blob);

    const formB = figurePosts.find((c) => c.url === '/api/questions/new-2/figures')!.init!.body as FormData;
    expect(formB.get('printedLabel')).toBe('Figure 5.33');
  });

  test('rejecting an add omits it from the PUT and skips its figure POST', async () => {
    const { calls } = installFetch();
    vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const page = await mountToStep3();

    // Reject add A (path 5.32) via its accept/reject toggle.
    const cardA = [...page.querySelectorAll('.fs-q')].find((c) => c.querySelector('.fs-q-label')?.textContent === '5.32')!;
    cardA.querySelector<HTMLButtonElement>('.fs-q-toggle')!.click();

    page.querySelector<HTMLButtonElement>('.fs-actions .primary-btn')!.click();
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));

    const put = calls.find((c) => c.method === 'PUT')!;
    const body = JSON.parse(put.init!.body as string).questions as Array<Record<string, unknown>>;
    // existing (edited) + only add B remain.
    expect(body.length).toBe(2);
    expect(body.map((q) => q.canonicalText)).toEqual(['edited text', 'Problem B']);

    // Only add B's figure POST fires (to the single new id new-1, not new-2).
    const figurePosts = calls.filter((c) => /\/figures$/.test(c.url) && c.method === 'POST');
    expect(figurePosts.length).toBe(1);
    expect(figurePosts[0]!.url).toBe('/api/questions/new-1/figures');
  });
});
