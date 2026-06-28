import { Router } from 'express';
import multer from 'multer';
import { bufferImage, type ImageMimeType } from '../llm/image-ref.js';
import { LlmError, type LlmProvider, type Message } from '../llm/provider.js';
import { requireCustomerId } from '../auth/index.js';
import { log } from '../logging/logger.js';
import {
  buildRetranscriptionPrompt,
  buildTranscriptionPrompt,
  transcriptionSchema,
} from '../llm/transcription-contract.js';
import type { Store } from '../storage/store.js';

/** Transcription is OCR-shaped — Haiku 4.5 is cheaper/faster and ample for reading an answer
 *  off a photo. Haiku rejects `effort`, so none is set. Tokens/timeout raised: a long answer
 *  transcribes to a lot of inline-LaTeX, and the read can run past the 120s default. */
const TRANSCRIPTION_MODEL = 'claude-sonnet-4-6';
const TRANSCRIPTION_MAX_TOKENS = 32_000;
const TRANSCRIPTION_TIMEOUT_MS = 300_000;

const IMAGE_EXTS: Record<string, ImageMimeType> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
};

function isImage(mimetype: string): mimetype is ImageMimeType {
  return mimetype in IMAGE_EXTS;
}

/**
 * Nested under /api/questions/:id/transcribe — read-only: answer image bytes in, inline-LaTeX
 * transcription out. Persists NOTHING (TODO 3e): images flow transiently to the provider and are
 * never written to disk. Retranscribe re-accepts the bytes plus a correction note.
 */
export function questionTranscribeRouter(store: Store, provider: LlmProvider): Router {
  const router = Router({ mergeParams: true });
  const upload = multer({ storage: multer.memoryStorage() });

  router.post('/', upload.array('images'), async (req, res) => {
    const customerId = requireCustomerId(req);
    const questionId = (req.params as { id: string }).id;
    const question = await store.questions.getById(customerId, questionId);
    if (!question) {
      res.status(404).json({ error: 'question not found' });
      return;
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: 'at least one image is required' });
      return;
    }
    for (const file of files) {
      if (!isImage(file.mimetype)) {
        res.status(400).json({ error: 'uploads must be images (png, jpeg, webp, gif)' });
        return;
      }
    }

    const images = files.map((f) => bufferImage(f.buffer, f.mimetype as ImageMimeType));
    log.info('transcribing answer', { question: questionId, images: files.length });

    const message: Message = {
      role: 'user',
      text: buildTranscriptionPrompt(question.canonicalText),
      images,
    };
    try {
      const out = await provider.completeStructured<{ transcription: string }>(
        [message],
        transcriptionSchema,
        {
          model: TRANSCRIPTION_MODEL,
          maxTokens: TRANSCRIPTION_MAX_TOKENS,
          timeoutMs: TRANSCRIPTION_TIMEOUT_MS,
          tag: 'transcription',
        },
      );
      res.json({ transcription: out.transcription });
    } catch (err) {
      if (err instanceof LlmError) {
        log.warn('transcription failed', { question: questionId });
        res.status(502).json({ error: 'transcription failed' });
        return;
      }
      throw err;
    }
  });

  // Retranscribe: re-uploaded image bytes + the current transcription + a correction note.
  // Still read-only; nothing is persisted, so the client must re-send the images.
  router.post('/retry', upload.array('images'), async (req, res) => {
    const customerId = requireCustomerId(req);
    const questionId = (req.params as { id: string }).id;
    const question = await store.questions.getById(customerId, questionId);
    if (!question) {
      res.status(404).json({ error: 'question not found' });
      return;
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: 'at least one image is required' });
      return;
    }
    for (const file of files) {
      if (!isImage(file.mimetype)) {
        res.status(400).json({ error: 'uploads must be images (png, jpeg, webp, gif)' });
        return;
      }
    }
    const { currentTranscription, correctionNote } = req.body ?? {};
    if (typeof currentTranscription !== 'string' || typeof correctionNote !== 'string') {
      res
        .status(400)
        .json({ error: 'currentTranscription and correctionNote are required strings' });
      return;
    }

    const images = files.map((f) => bufferImage(f.buffer, f.mimetype as ImageMimeType));
    log.info('retranscribing answer', { question: questionId, images: files.length });

    const message: Message = {
      role: 'user',
      text: buildRetranscriptionPrompt(question.canonicalText, currentTranscription, correctionNote),
      images,
    };
    try {
      const out = await provider.completeStructured<{ transcription: string }>(
        [message],
        transcriptionSchema,
        {
          model: TRANSCRIPTION_MODEL,
          maxTokens: TRANSCRIPTION_MAX_TOKENS,
          timeoutMs: TRANSCRIPTION_TIMEOUT_MS,
          tag: 'retranscription',
        },
      );
      res.json({ transcription: out.transcription });
    } catch (err) {
      if (err instanceof LlmError) {
        log.warn('retranscription failed', { question: questionId });
        res.status(502).json({ error: 'transcription failed' });
        return;
      }
      throw err;
    }
  });

  return router;
}
