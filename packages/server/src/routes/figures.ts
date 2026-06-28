import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { newId, nowIso } from '../domain/ids.js';
import type { Figure } from '../domain/types.js';
import { log } from '../logging/logger.js';
import { requireCustomerId } from '../auth/index.js';
import type { Store } from '../storage/store.js';

/** Canonical UUID shape — image serving validates :figId against this before touching the FS. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);

/** The public shape of a figure: id + an authed image URL + the matcher's read. */
function toFigureDto(fig: Figure): {
  id: string;
  url: string;
  printedLabel?: string;
  confidence?: 'high' | 'medium' | 'low';
} {
  return {
    id: fig.id,
    url: `/api/figures/${fig.id}/image`,
    ...(fig.printedLabel ? { printedLabel: fig.printedLabel } : {}),
    ...(fig.confidence ? { confidence: fig.confidence } : {}),
  };
}

/**
 * Nested under /api/questions/:id/figures — attach (POST), list (GET), remove (DELETE) the
 * crops of one question. Crops are baked client-side at commit; this stores the bytes + row.
 */
export function questionFiguresRouter(store: Store): Router {
  const router = Router({ mergeParams: true });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 }, // one crop, ≤5 MB
  });

  const acceptCrop = (req: Request, res: Response, next: NextFunction) => {
    upload.single('crop')(req, res, (err: unknown) => {
      if (err) {
        res.status(400).json({ error: 'attach one crop image ≤5 MB as `crop`' });
        return;
      }
      next();
    });
  };

  // POST — verify the question is owned, write blob then row (rollback the blob on row failure).
  router.post('/', acceptCrop, async (req, res) => {
    const customerId = requireCustomerId(req);
    const questionId = (req.params as { id: string }).id;
    const question = await store.questions.getById(customerId, questionId);
    if (!question) {
      res.status(404).json({ error: 'question not found' });
      return;
    }
    const file = (req as { file?: Express.Multer.File }).file;
    if (!file || file.mimetype !== 'image/webp') {
      res.status(400).json({ error: 'crop must be image/webp' });
      return;
    }

    const body = req.body ?? {};
    const printedLabel = typeof body.printedLabel === 'string' && body.printedLabel.trim() !== ''
      ? body.printedLabel
      : undefined;
    // A bad confidence is cosmetic — drop it, never fail the upload.
    const confidence =
      typeof body.confidence === 'string' && VALID_CONFIDENCE.has(body.confidence)
        ? (body.confidence as 'high' | 'medium' | 'low')
        : undefined;

    const figId = newId();
    await store.figureBlobs.put(figId, file.buffer);
    const figure: Figure = {
      id: figId,
      customerId,
      questionId,
      ...(printedLabel ? { printedLabel } : {}),
      ...(confidence ? { confidence } : {}),
      createdAt: nowIso(),
    };
    try {
      await store.figures.create(customerId, figure);
    } catch (err) {
      // Write-blob-then-row: if the row fails, drop the orphan blob (best-effort) and rethrow.
      await store.figureBlobs.delete(figId).catch(() => {});
      throw err;
    }
    res.status(201).json(toFigureDto(figure));
  });

  // GET list — figures for this question, oldest first (display order = createdAt asc).
  router.get('/', async (req, res) => {
    const customerId = requireCustomerId(req);
    const questionId = (req.params as { id: string }).id;
    const question = await store.questions.getById(customerId, questionId);
    if (!question) {
      res.status(404).json({ error: 'question not found' });
      return;
    }
    const figures = (await store.figures.getAll(customerId))
      .filter((f) => f.questionId === questionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    res.json(figures.map(toFigureDto));
  });

  // DELETE — delete the row first, then the blob (a crash leaves at worst an orphan blob,
  // never a row pointing at a missing file). Blob delete is best-effort.
  router.delete('/:figId', async (req, res) => {
    const customerId = requireCustomerId(req);
    const { id: questionId, figId } = req.params as { id: string; figId: string };
    const figure = await store.figures.getById(customerId, figId);
    if (!figure || figure.questionId !== questionId) {
      res.status(404).json({ error: 'figure not found' });
      return;
    }
    await store.figures.delete(customerId, figId);
    await store.figureBlobs.delete(figId).catch((err) => {
      log.warn('figure blob delete failed (orphan left)', { figId, error: (err as Error).message });
    });
    res.status(204).end();
  });

  return router;
}

/**
 * Flat /api/figures/:figId/image — streams the crop, customer-scoped. The figure-row lookup
 * is the ONLY thing isolating one customer's crops from another's (blobs are flat in imgs/),
 * so it runs before the file read. :figId is UUID-validated first so raw input never hits the FS.
 */
export function figuresRouter(store: Store): Router {
  const router = Router();

  router.get('/:figId/image', async (req, res) => {
    const figId = req.params.figId;
    if (!UUID_RE.test(figId)) {
      res.status(400).json({ error: 'bad figure id' });
      return;
    }
    const customerId = requireCustomerId(req);
    const figure = await store.figures.getById(customerId, figId);
    if (!figure) {
      res.status(404).json({ error: 'figure not found' });
      return;
    }
    res.set('Content-Type', 'image/webp');
    // `private` (not `public`): the crop is customer-owned; a shared proxy must not cache it.
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.sendFile(store.figureBlobs.path(figId));
  });

  return router;
}
