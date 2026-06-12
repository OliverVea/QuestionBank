import { Router } from 'express';
import multer from 'multer';
import { bufferImage, type ImageMimeType } from '../llm/image-ref.js';
import { LlmError, type LlmProvider, type Message } from '../llm/provider.js';
import { extractQuestions, parseExtractionResult } from '../llm/extract.js';
import { extractionPrompt, extractionSchema } from '../llm/extraction-contract.js';
import { log } from '../logging/logger.js';

const VALID_MIME: Record<string, ImageMimeType> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
};

/**
 * POST /api/extract — accepts a single image, returns extracted questions.
 * POST /api/extract/refine — accepts image + current extraction + user note, re-extracts.
 * Stateless: nothing is persisted; the client decides what to keep.
 */
export function extractRouter(provider: LlmProvider): Router {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  });

  router.post('/', upload.single('image'), async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'an image file is required' });
      return;
    }
    if (!(file.mimetype in VALID_MIME)) {
      res.status(400).json({ error: 'upload must be an image (png, jpeg, webp, gif)' });
      return;
    }

    const image = bufferImage(file.buffer, file.mimetype as ImageMimeType);
    log.info('extracting problems from image', { size: file.size });

    try {
      const questions = await extractQuestions(provider, image);
      res.json({ questions });
    } catch (err) {
      if (err instanceof LlmError) {
        log.warn('extraction failed', { error: (err as Error).message });
        res.status(502).json({ error: 'extraction failed' });
        return;
      }
      throw err;
    }
  });

  /** Refine: re-extract with the user's correction note applied to the conversation. */
  router.post('/refine', upload.single('image'), async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'an image file is required' });
      return;
    }
    if (!(file.mimetype in VALID_MIME)) {
      res.status(400).json({ error: 'upload must be an image (png, jpeg, webp, gif)' });
      return;
    }

    const { currentExtraction: rawExtraction, note } = req.body ?? {};
    if (typeof note !== 'string' || !note.trim()) {
      res.status(400).json({ error: 'note is required' });
      return;
    }

    let currentExtraction: unknown[] = [];
    if (typeof rawExtraction === 'string') {
      try { currentExtraction = JSON.parse(rawExtraction); } catch { /* use empty */ }
    } else if (Array.isArray(rawExtraction)) {
      currentExtraction = rawExtraction;
    }

    const image = bufferImage(file.buffer, file.mimetype as ImageMimeType);
    log.info('refining extraction', { size: file.size, note: note.slice(0, 80) });

    // Build conversation: original extraction prompt + image → assistant's prior answer → user's note.
    const messages: Message[] = [
      { role: 'user', text: extractionPrompt, images: [image] },
      { role: 'assistant', text: JSON.stringify({ questions: currentExtraction }) },
      { role: 'user', text: `The user wants changes to the extraction above. Apply the following correction and return the updated full questions array:\n\n${note}` },
    ];

    const envelopeSchema = {
      type: 'object',
      properties: { questions: extractionSchema },
      required: ['questions'],
      additionalProperties: false,
    } as const;

    try {
      const result = await provider.completeStructured<unknown>(messages, envelopeSchema);
      const questions = parseExtractionResult(result);
      res.json({ questions });
    } catch (err) {
      if (err instanceof LlmError) {
        log.warn('refinement failed', { error: (err as Error).message });
        res.status(502).json({ error: 'refinement failed' });
        return;
      }
      throw err;
    }
  });

  return router;
}
