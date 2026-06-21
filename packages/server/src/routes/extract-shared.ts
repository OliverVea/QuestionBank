import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { bufferImage, type ImageMimeType, type ImageRef } from '../llm/image-ref.js';
import type { ExistingProblem } from '../llm/extraction-contract.js';
import type { Store } from '../storage/store.js';

/** Shared page-image intake for /api/extract and /api/scan: same multer limits + parsing. */
export const MAX_IMAGES = 5;

export const VALID_MIME: Record<string, ImageMimeType> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
};

/** One accepted upload: the raw bytes + mime (for figure-service/sharp) plus an ImageRef (for the LLM). */
export interface UploadedImage {
  buffer: Buffer;
  mime: ImageMimeType;
  ref: ImageRef;
}

/** Multer instance with the shared limits (≤5 images, ≤10 MB each). */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: MAX_IMAGES },
});

/**
 * Middleware: parse `images[]` and turn any multer error (e.g. LIMIT_FILE_COUNT past
 * `files`) into a clean 400 rather than a 500.
 */
export const acceptImages = (req: Request, res: Response, next: NextFunction): void => {
  upload.array('images', MAX_IMAGES)(req, res, (err: unknown) => {
    if (err) {
      res.status(400).json({ error: `up to ${MAX_IMAGES} page images, each ≤10 MB` });
      return;
    }
    next();
  });
};

/** Pull validated uploads from the multipart files, or null if empty / any wrong mime. */
export function readImages(req: Request): UploadedImage[] | null {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) return null;
  const out: UploadedImage[] = [];
  for (const f of files) {
    if (!(f.mimetype in VALID_MIME)) return null;
    const mime = f.mimetype as ImageMimeType;
    out.push({ buffer: f.buffer, mime, ref: bufferImage(f.buffer, mime) });
  }
  return out;
}

/** Load the book's existing problems as { id, path, text } for the dedupe prompt. */
export async function loadExisting(
  store: Store,
  customerId: string,
  bookId: string,
): Promise<ExistingProblem[]> {
  const questions = (await store.questions.getAll(customerId)).filter((q) => q.bookId === bookId);
  return questions.map((q) => ({ id: q.id, path: q.label, text: q.canonicalText }));
}
