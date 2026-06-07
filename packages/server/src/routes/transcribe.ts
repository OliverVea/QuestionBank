import { join } from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { bufferImage, fileImage, type ImageMimeType } from '../llm/image-ref.js';
import { LlmError, type LlmProvider, type Message } from '../llm/provider.js';
import { log } from '../logging/logger.js';
import {
  buildTranscriptionPrompt,
  buildRetranscriptionPrompt,
  transcriptionSchema,
} from '../llm/transcription-contract.js';
import type { ImageStore } from '../storage/images.js';
import type { Store } from '../storage/store.js';

function imageExt(mimetype: string): string | undefined {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  return map[mimetype];
}

/** Nested under /api/questions/:id/transcribe — multi-image → one combined transcription. */
export function questionTranscribeRouter(
  store: Store,
  provider: LlmProvider,
  imageStore: ImageStore,
  dataDir: string,
): Router {
  const router = Router({ mergeParams: true });
  const upload = multer({ storage: multer.memoryStorage() });

  router.post('/', upload.array('images'), async (req, res) => {
    const questionId = (req.params as { id: string }).id;
    const question = store.questions.getById(questionId);
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
      if (!imageExt(file.mimetype)) {
        res.status(400).json({ error: 'uploads must be images (png, jpeg, webp, gif)' });
        return;
      }
    }

    const imagePaths: string[] = [];
    const images = [];
    for (const file of files) {
      const ext = imageExt(file.mimetype)!;
      const { imagePath } = await imageStore.save(file.buffer, ext);
      imagePaths.push(imagePath);
      images.push(bufferImage(file.buffer, file.mimetype as ImageMimeType));
    }

    log.info('transcribing answer', { question: questionId, label: question.label, images: files.length });

    const message: Message = {
      role: 'user',
      text: buildTranscriptionPrompt(question.canonicalText),
      images,
    };

    try {
      const out = await provider.completeStructured<{ transcription: string }>(
        [message],
        transcriptionSchema,
      );
      log.info('transcription complete', { question: questionId, chars: out.transcription.length });
      res.json({ transcription: out.transcription, imagePaths });
    } catch (err) {
      if (err instanceof LlmError) {
        log.warn('transcription failed', { question: questionId });
        res.status(502).json({ error: 'transcription failed' });
        return;
      }
      throw err;
    }
  });

  // Retranscribe using saved image paths + a plain-English correction note.
  // Does NOT re-upload; images are already on disk from the first transcription.
  router.post('/retry', async (req, res) => {
    const questionId = (req.params as { id: string }).id;
    const question = store.questions.getById(questionId);
    if (!question) {
      res.status(404).json({ error: 'question not found' });
      return;
    }
    const { imagePaths, currentTranscription, correctionNote } = req.body ?? {};
    if (
      !Array.isArray(imagePaths) ||
      imagePaths.some((p: unknown) => typeof p !== 'string') ||
      imagePaths.length === 0
    ) {
      res.status(400).json({ error: 'imagePaths must be a non-empty array of strings' });
      return;
    }
    if (typeof currentTranscription !== 'string' || typeof correctionNote !== 'string') {
      res.status(400).json({ error: 'currentTranscription and correctionNote are required strings' });
      return;
    }

    const images = (imagePaths as string[]).map((p) => {
      const ext = p.split('.').pop() ?? 'jpg';
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return fileImage(join(dataDir, p), mime as ImageMimeType);
    });

    log.info('retranscribing answer', { question: questionId, images: imagePaths.length });

    const message: Message = {
      role: 'user',
      text: buildRetranscriptionPrompt(
        question.canonicalText,
        currentTranscription,
        correctionNote,
      ),
      images,
    };

    try {
      const out = await provider.completeStructured<{ transcription: string }>(
        [message],
        transcriptionSchema,
      );
      log.info('retranscription complete', { question: questionId, chars: out.transcription.length });
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
