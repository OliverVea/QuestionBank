import { Router } from 'express';
import { newId, nowIso } from '../domain/ids.js';
import type { Question } from '../domain/types.js';
import type { Store } from '../storage/store.js';

/** Nested under /api/chapters/:chapterId/questions — list + manual create. */
export function chapterQuestionsRouter(store: Store): Router {
  const router = Router({ mergeParams: true });

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
    const patch: Partial<Omit<Question, 'id'>> = {};
    const { canonicalText, label } = req.body ?? {};
    if (typeof canonicalText === 'string') patch.canonicalText = canonicalText.trim();
    if (typeof label === 'string') patch.label = label.trim();
    res.json(store.questions.update(req.params.id, patch));
  });

  router.delete('/:id', (req, res) => {
    store.questions.delete(req.params.id);
    res.status(204).end();
  });

  return router;
}
