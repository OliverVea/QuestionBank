import { Router } from 'express';
import multer from 'multer';
import { newId, nowIso } from '../domain/ids.js';
import type { Question } from '../domain/types.js';
import { extractQuestions } from '../llm/extract.js';
import { bufferImage, type ImageMimeType } from '../llm/image-ref.js';
import { LlmError, type LlmProvider } from '../llm/provider.js';
import type { ImageStore } from '../storage/images.js';
import type { Store } from '../storage/store.js';

/** Map a known image mimetype to a file extension; undefined ⇒ not an accepted image. */
function imageExt(mimetype: string): string | undefined {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  return map[mimetype];
}

/** Nested under /api/chapters/:chapterId/questions — list, manual create, and extract-from-image. */
export function chapterQuestionsRouter(
  store: Store,
  provider: LlmProvider,
  imageStore: ImageStore,
): Router {
  const router = Router({ mergeParams: true });
  // Memory storage: we read the buffer ourselves and hand it to ImageStore.
  const upload = multer({ storage: multer.memoryStorage() });

  router.get('/', (req, res) => {
    const chapterId = (req.params as { chapterId: string }).chapterId;
    res.json(store.questions.getAll().filter((q) => q.chapterId === chapterId));
  });

  router.post('/', (req, res) => {
    const chapterId = (req.params as { chapterId: string }).chapterId;
    if (!store.chapters.getById(chapterId)) {
      res.status(404).json({ error: 'chapter not found' });
      return;
    }
    const { canonicalText, label } = req.body ?? {};
    if (typeof canonicalText !== 'string' || canonicalText.trim() === '') {
      res.status(400).json({ error: 'canonicalText is required' });
      return;
    }
    const text = canonicalText.trim();
    const question: Question = {
      id: newId(),
      chapterId,
      canonicalText: text,
      source: { kind: 'text', rawText: text },
      createdAt: nowIso(),
      ...(typeof label === 'string' && label.trim() !== '' ? { label: label.trim() } : {}),
    };
    res.status(201).json(store.questions.create(question));
  });

  router.post('/extract', upload.single('image'), async (req, res) => {
    const chapterId = (req.params as { chapterId: string }).chapterId;
    if (!store.chapters.getById(chapterId)) {
      res.status(404).json({ error: 'chapter not found' });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'an image file is required' });
      return;
    }
    const ext = imageExt(file.mimetype);
    if (!ext) {
      res.status(400).json({ error: 'upload must be an image (png, jpeg, webp, gif)' });
      return;
    }

    // Store the image first; it is retained even if extraction fails (lets the user retry).
    const { imagePath } = await imageStore.save(file.buffer, ext);

    let extracted;
    try {
      extracted = await extractQuestions(
        provider,
        bufferImage(file.buffer, file.mimetype as ImageMimeType),
      );
    } catch (err) {
      if (err instanceof LlmError) {
        res.status(502).json({ error: 'extraction failed' });
        return;
      }
      throw err;
    }

    const created = extracted.map((q) =>
      store.questions.create({
        id: newId(),
        chapterId,
        canonicalText: q.canonicalText,
        source: { kind: 'image', imagePath },
        createdAt: nowIso(),
        ...(q.label && q.label.trim() !== '' ? { label: q.label.trim() } : {}),
      }),
    );
    res.status(201).json(created);
  });

  return router;
}

/** Flat /api/questions/:id — patch + delete. */
export function questionsRouter(store: Store): Router {
  const router = Router();

  router.patch('/:id', (req, res) => {
    if (!store.questions.getById(req.params.id)) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const { canonicalText, label, skipped, snoozedUntil } = req.body ?? {};

    // Clear-snooze: update() shallow-merges and cannot remove a key, so delete + re-create.
    if (snoozedUntil === null) {
      const current = store.questions.getById(req.params.id)!;
      const { snoozedUntil: _drop, ...rest } = current;
      const rebuilt: Question = { ...rest };
      if (typeof canonicalText === 'string') rebuilt.canonicalText = canonicalText.trim();
      if (typeof label === 'string') rebuilt.label = label.trim();
      if (typeof skipped === 'boolean') rebuilt.skipped = skipped;
      store.questions.delete(req.params.id);
      res.json(store.questions.create(rebuilt));
      return;
    }

    const patch: Partial<Omit<Question, 'id'>> = {};
    if (typeof canonicalText === 'string') patch.canonicalText = canonicalText.trim();
    if (typeof label === 'string') patch.label = label.trim();
    if (typeof skipped === 'boolean') patch.skipped = skipped;
    if (typeof snoozedUntil === 'string') patch.snoozedUntil = snoozedUntil;
    res.json(store.questions.update(req.params.id, patch));
  });

  router.delete('/:id', (req, res) => {
    store.questions.delete(req.params.id);
    res.status(204).end();
  });

  return router;
}
