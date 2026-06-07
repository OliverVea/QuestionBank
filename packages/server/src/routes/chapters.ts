import { Router } from 'express';
import { newId, nowIso } from '../domain/ids.js';
import type { Chapter } from '../domain/types.js';
import { deleteChapterCascade } from '../services/cascade.js';
import type { Store } from '../storage/store.js';

/** Nested under /api/books/:bookId/chapters — list + create. */
export function bookChaptersRouter(store: Store): Router {
  const router = Router({ mergeParams: true });

  router.get('/', (req, res) => {
    const bookId = (req.params as { bookId: string }).bookId;
    const chapters = store.chapters
      .getAll()
      .filter((c) => c.bookId === bookId)
      .sort((a, b) => a.order - b.order);
    res.json(chapters);
  });

  router.post('/', (req, res) => {
    const bookId = (req.params as { bookId: string }).bookId;
    if (!store.books.getById(bookId)) {
      res.status(404).json({ error: 'book not found' });
      return;
    }
    const { title, description } = req.body ?? {};
    if (typeof title !== 'string' || title.trim() === '') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const siblings = store.chapters.getAll().filter((c) => c.bookId === bookId);
    const nextOrder = siblings.reduce((max, c) => Math.max(max, c.order + 1), 0);
    const chapter: Chapter = {
      id: newId(),
      bookId,
      title: title.trim(),
      order: nextOrder,
      createdAt: nowIso(),
      ...(typeof description === 'string' && description.trim() !== ''
        ? { description: description.trim() }
        : {}),
    };
    res.status(201).json(store.chapters.create(chapter));
  });

  return router;
}

/** Flat /api/chapters/:id — patch + delete. */
export function chaptersRouter(store: Store): Router {
  const router = Router();

  router.patch('/:id', (req, res) => {
    if (!store.chapters.getById(req.params.id)) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const patch: Partial<Omit<Chapter, 'id'>> = {};
    const { title, description, order } = req.body ?? {};
    if (typeof title === 'string') patch.title = title.trim();
    if (typeof description === 'string') patch.description = description.trim();
    if (typeof order === 'number') patch.order = order;
    res.json(store.chapters.update(req.params.id, patch));
  });

  router.delete('/:id', (req, res) => {
    deleteChapterCascade(store, req.params.id);
    res.status(204).end();
  });

  return router;
}
