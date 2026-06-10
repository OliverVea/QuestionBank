import { Router } from 'express';
import { newId, nowIso } from '../domain/ids.js';
import type { Chapter } from '../domain/types.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import { deleteChapterCascade } from '../services/cascade.js';
import type { Store } from '../storage/store.js';

/** Nested under /api/books/:bookId/chapters — list + create. */
export function bookChaptersRouter(store: Store): Router {
  const router = Router({ mergeParams: true });

  router.get('/', async (req, res) => {
    const customerId = requireCustomerId(req);
    const bookId = (req.params as { bookId: string }).bookId;
    const chapters = (await store.chapters.getAll(customerId))
      .filter((c) => c.bookId === bookId)
      .sort((a, b) => a.order - b.order);
    res.json(chapters);
  });

  router.post('/', async (req, res) => {
    const customerId = requireCustomerId(req);
    const bookId = (req.params as { bookId: string }).bookId;
    if (!(await store.books.getById(customerId, bookId))) {
      res.status(404).json({ error: 'book not found' });
      return;
    }
    const { title, description } = req.body ?? {};
    if (typeof title !== 'string' || title.trim() === '') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const siblings = (await store.chapters.getAll(customerId)).filter((c) => c.bookId === bookId);
    const nextOrder = siblings.reduce((max, c) => Math.max(max, c.order + 1), 0);
    const chapter: Chapter = {
      id: newId(),
      customerId,
      bookId,
      title: title.trim(),
      order: nextOrder,
      createdAt: nowIso(),
      ...(typeof description === 'string' && description.trim() !== ''
        ? { description: description.trim() }
        : {}),
    };
    res.status(201).json(await store.chapters.create(customerId, chapter));
  });

  return router;
}

/** Flat /api/chapters/:id — patch + delete. */
export function chaptersRouter(store: Store): Router {
  const router = Router();

  router.patch('/:id', async (req, res) => {
    const customerId = requireCustomerId(req);
    if (!(await store.chapters.getById(customerId, req.params.id))) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const patch: Partial<Omit<Chapter, 'id' | 'customerId'>> = {};
    const { title, description, order } = req.body ?? {};
    if (typeof title === 'string') patch.title = title.trim();
    if (typeof description === 'string') patch.description = description.trim();
    if (typeof order === 'number') patch.order = order;
    res.json(await store.chapters.update(customerId, req.params.id, patch));
  });

  router.delete('/:id', async (req, res) => {
    await deleteChapterCascade(store, requireCustomerId(req), req.params.id);
    res.status(204).end();
  });

  return router;
}
