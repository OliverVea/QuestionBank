import { Router } from 'express';
import multer from 'multer';
import { bufferImage, type ImageMimeType } from '../llm/image-ref.js';
import { LlmError, type LlmProvider, type Message } from '../llm/provider.js';
import { buildTranscriptionPrompt, transcriptionSchema } from '../llm/transcription-contract.js';
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
      res.json({ transcription: out.transcription, imagePaths });
    } catch (err) {
      if (err instanceof LlmError) {
        res.status(502).json({ error: 'transcription failed' });
        return;
      }
      throw err;
    }
  });

  return router;
}
