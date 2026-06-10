import { Router } from 'express';
import { newId, nowIso } from '../domain/ids.js';
import type { Book } from '../domain/types.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import { deleteBookCascade } from '../services/cascade.js';
import { buildBookTree } from '../services/tree.js';
import type { Store } from '../storage/store.js';

export function booksRouter(store: Store): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await store.books.getAll(requireCustomerId(req)));
  });

  router.post('/', async (req, res) => {
    const customerId = requireCustomerId(req);
    const { title, author, learningGoal } = req.body ?? {};
    if (typeof title !== 'string' || title.trim() === '') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const book: Book = {
      id: newId(),
      customerId,
      title: title.trim(),
      createdAt: nowIso(),
      ...(typeof author === 'string' && author.trim() !== '' ? { author: author.trim() } : {}),
      ...(typeof learningGoal === 'string' && learningGoal.trim() !== ''
        ? { learningGoal: learningGoal.trim() }
        : {}),
    };
    res.status(201).json(await store.books.create(customerId, book));
  });

  router.get('/:id/tree', async (req, res) => {
    const tree = await buildBookTree(store, requireCustomerId(req), req.params.id);
    if (!tree) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(tree);
  });

  router.get('/:id', async (req, res) => {
    const book = await store.books.getById(requireCustomerId(req), req.params.id);
    if (!book) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(book);
  });

  router.patch('/:id', async (req, res) => {
    const customerId = requireCustomerId(req);
    if (!(await store.books.getById(customerId, req.params.id))) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const patch: Partial<Omit<Book, 'id' | 'customerId'>> = {};
    const { title, author, learningGoal } = req.body ?? {};
    if (typeof title === 'string') patch.title = title.trim();
    if (typeof author === 'string') patch.author = author.trim();
    if (typeof learningGoal === 'string') patch.learningGoal = learningGoal.trim();
    res.json(await store.books.update(customerId, req.params.id, patch));
  });

  router.delete('/:id', async (req, res) => {
    await deleteBookCascade(store, requireCustomerId(req), req.params.id);
    res.status(204).end();
  });

  return router;
}
