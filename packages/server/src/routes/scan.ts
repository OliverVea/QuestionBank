import { Router } from 'express';
import sharp from 'sharp';
import { buildExtractionPrompt, extractionEnvelopeSchema } from '../llm/extraction-contract.js';
import { validateExtractionEnvelope, type ExtractionEnvelope } from '../llm/extraction-delta.js';
import { bufferImage } from '../llm/image-ref.js';
import { LlmError, type LlmProvider, type Message } from '../llm/provider.js';
import { runMatcher, type FigureMatch, type MatchCandidate } from '../llm/matcher-contract.js';
import { log } from '../logging/logger.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import type { FigureServiceClient, ProcessResult } from '../services/figure-service-client.js';
import type { Store } from '../storage/store.js';
import { acceptImages, loadExisting, readImages } from './extract-shared.js';

/** One flattened page: its order index + the figure-service result. */
interface FlatPage {
  pageIndex: number;
  result: ProcessResult;
}

/** A figure in global reading order (page order, then within-page order). */
interface GlobalFigure {
  pageIndex: number;
  detectionId: number;
  box: [number, number, number, number];
  score: number;
}

interface ScanResponseFigure {
  detectionId: number;
  box: [number, number, number, number];
  score: number;
  matchedAddIndex?: number | null;
  printedLabel?: string;
  confidence?: 'high' | 'medium' | 'low';
}

/**
 * Long-edge cap (px) for images sent to the matcher. Anthropic vision downsamples anything
 * over ~1568px anyway, and the full-res rectified page (3472×4624 PNG ≈ 19 MB base64) blows
 * the hard 10 MB/image limit. Downscaling fixes the size AND cuts cost/latency at no quality
 * loss the model would see.
 */
const VISION_MAX_EDGE = 1568;

/**
 * Prepare an image for the matcher: cap the long edge at {@link VISION_MAX_EDGE} and re-encode
 * as JPEG. JPEG (not PNG) because these are photographs of textbook pages — far smaller bytes,
 * keeping us well under the 10 MB/image limit even before the resize takes effect. Never
 * enlarges, so small crops pass through untouched.
 */
async function downscaleForVision(img: Buffer): Promise<Buffer> {
  return sharp(img)
    .resize(VISION_MAX_EDGE, VISION_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

/** Cut one crop from a rectified PNG buffer, clamping the box to the image bounds. */
async function cutCrop(
  png: Buffer,
  box: [number, number, number, number],
  imgW: number,
  imgH: number,
): Promise<Buffer> {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const left = clamp(Math.round(box[0]), 0, Math.max(0, imgW - 1));
  const top = clamp(Math.round(box[1]), 0, Math.max(0, imgH - 1));
  const right = clamp(Math.round(box[2]), left + 1, imgW);
  const bottom = clamp(Math.round(box[3]), top + 1, imgH);
  return sharp(png)
    .extract({ left, top, width: right - left, height: bottom - top })
    .png()
    .toBuffer();
}

/**
 * POST /api/scan — multipart page images + bookId. Orchestrates the read pipeline:
 *   (1 ∥ 2) → 3 — flatten via figure-service ∥ extract problems via Claude, then match.
 * Extraction is required (failure → 502); figures are best-effort (figuresError /
 * matchError) so the wizard always gets problems even when the image half is down.
 */
export function scanRouter(
  provider: LlmProvider,
  store: Store,
  figureService: FigureServiceClient | null,
): Router {
  const router = Router();

  router.post('/', acceptImages, async (req, res) => {
    const customerId = requireCustomerId(req);
    const bookId = (req.body ?? {}).bookId;
    if (typeof bookId !== 'string' || bookId.trim() === '') {
      res.status(400).json({ error: 'bookId is required' });
      return;
    }
    const images = readImages(req);
    if (!images) {
      res.status(400).json({ error: 'attach 1–5 image files (png, jpeg, webp, gif)' });
      return;
    }
    const book = await store.books.getById(customerId, bookId);
    if (!book) {
      res.status(404).json({ error: 'book not found' });
      return;
    }

    const existing = await loadExisting(store, customerId, bookId);
    const prompt = buildExtractionPrompt(existing, book.learningGoal);
    const messages: Message[] = [
      { role: 'user', text: prompt, images: images.map((u) => u.ref) },
    ];
    log.info('scanning pages', { pages: images.length, existing: existing.length });

    // (A) extract — REQUIRED. (B) flatten — best-effort, NEVER rejects (self-catch), so the
    // Promise.all only rejects via A, which maps to a 502 like /api/extract today.
    const extractTask = (async (): Promise<ExtractionEnvelope> => {
      const raw = await provider.completeStructured<unknown>(messages, extractionEnvelopeSchema, {
        tag: 'extraction',
      });
      return validateExtractionEnvelope(raw, existing.map((e) => e.id), images.length);
    })();

    const flattenTask = (async (): Promise<{ pages: FlatPage[]; figuresError: boolean }> => {
      if (!figureService) return { pages: [], figuresError: true };
      try {
        const pages: FlatPage[] = [];
        for (let i = 0; i < images.length; i++) {
          const result = await figureService.process(images[i]!.buffer, images[i]!.mime);
          pages.push({ pageIndex: i, result });
        }
        return { pages, figuresError: false };
      } catch (err) {
        log.warn('figure flatten failed (best-effort)', { error: (err as Error).message });
        return { pages: [], figuresError: true };
      }
    })();

    let envelope: ExtractionEnvelope;
    let flat: { pages: FlatPage[]; figuresError: boolean };
    try {
      [envelope, flat] = await Promise.all([extractTask, flattenTask]);
    } catch (err) {
      if (err instanceof LlmError) {
        log.warn('scan extraction failed', { error: (err as Error).message });
        res.status(502).json({ error: 'extraction failed' });
        return;
      }
      throw err;
    }

    // Match gate: candidate `add`s with refs, keeping the resolved-array index.
    const addsWithRefs = envelope.resolved
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => d.kind === 'add' && (d.figureRefs?.length ?? 0) > 0);

    // Global reading-order figure list, aligned to crop order for the matcher.
    const globalFigures: GlobalFigure[] = [];
    for (const page of flat.pages) {
      for (const fig of page.result.figures) {
        globalFigures.push({
          pageIndex: page.pageIndex,
          detectionId: fig.id,
          box: fig.box,
          score: fig.score,
        });
      }
    }

    let matchError = false;
    const matchByFigIndex = new Map<number, FigureMatch>();
    if (addsWithRefs.length > 0 && globalFigures.length > 0) {
      try {
        // Cut a crop per detected figure from its page's rectified PNG, in reading order.
        const pageBuffers = new Map<number, Buffer>(
          flat.pages.map((p) => [p.pageIndex, Buffer.from(p.result.rectified.pngBase64, 'base64')]),
        );
        const cropBuffers: Buffer[] = [];
        for (const gf of globalFigures) {
          const page = flat.pages.find((p) => p.pageIndex === gf.pageIndex)!;
          cropBuffers.push(
            await cutCrop(
              pageBuffers.get(gf.pageIndex)!,
              gf.box,
              page.result.rectified.width,
              page.result.rectified.height,
            ),
          );
        }
        const candidates: MatchCandidate[] = addsWithRefs.map(({ d }) => ({
          label: d.path ?? '',
          figureRefs: d.figureRefs ?? [],
        }));
        // Downscale pages + crops before the call — the full-res rectified PNG is ~19 MB
        // base64, over Anthropic's 10 MB/image hard limit. Crops are cut at full res first
        // (above) for sharpness, then capped here.
        const pageImages = await Promise.all(
          flat.pages.map(async (p) =>
            bufferImage(await downscaleForVision(pageBuffers.get(p.pageIndex)!), 'image/jpeg'),
          ),
        );
        const cropImages = await Promise.all(
          cropBuffers.map(async (b) => bufferImage(await downscaleForVision(b), 'image/jpeg')),
        );
        const result = await runMatcher(provider, { pageImages, cropImages, candidates });
        for (const m of result.matches) matchByFigIndex.set(m.figureIndex, m);
      } catch (err) {
        matchError = true;
        log.warn('figure matching failed (best-effort)', { error: (err as Error).message });
      }
    }

    // Fold matches onto figures, mapping the candidate-list index back to the resolved-array index.
    const responsePages = flat.pages.map((page) => {
      const figures: ScanResponseFigure[] = page.result.figures.map((fig) => {
        const globalIndex = globalFigures.findIndex(
          (gf) => gf.pageIndex === page.pageIndex && gf.detectionId === fig.id,
        );
        const match = matchByFigIndex.get(globalIndex);
        const base: ScanResponseFigure = { detectionId: fig.id, box: fig.box, score: fig.score };
        if (match) {
          const matchedAddIndex =
            match.matchedProblemIndex !== null && addsWithRefs[match.matchedProblemIndex]
              ? addsWithRefs[match.matchedProblemIndex]!.i
              : null;
          base.matchedAddIndex = matchedAddIndex;
          base.printedLabel = match.printedLabel;
          base.confidence = match.confidence;
        }
        return base;
      });
      return {
        pageIndex: page.pageIndex,
        rectified: page.result.rectified,
        figures,
      };
    });

    res.json({
      envelope,
      pages: responsePages,
      ...(flat.figuresError ? { figuresError: true } : {}),
      ...(matchError ? { matchError: true } : {}),
    });
  });

  return router;
}
