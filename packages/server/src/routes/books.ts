import { Router } from 'express';
import { newId, nowIso } from '../domain/ids.js';
import type { Book } from '../domain/types.js';
import type { Store } from '../storage/store.js';

export function booksRouter(store: Store): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(store.books.getAll());
  });

  router.post('/', (req, res) => {
    const { title, author, learningGoal } = req.body ?? {};
    if (typeof title !== 'string' || title.trim() === '') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const book: Book = {
      id: newId(),
      title: title.trim(),
      createdAt: nowIso(),
      ...(typeof author === 'string' && author.trim() !== '' ? { author: author.trim() } : {}),
      ...(typeof learningGoal === 'string' && learningGoal.trim() !== ''
        ? { learningGoal: learningGoal.trim() }
        : {}),
    };
    res.status(201).json(store.books.create(book));
  });

  router.get('/:id', (req, res) => {
    const book = store.books.getById(req.params.id);
    if (!book) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(book);
  });

  router.patch('/:id', (req, res) => {
    if (!store.books.getById(req.params.id)) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const patch: Partial<Omit<Book, 'id'>> = {};
    const { title, author, learningGoal } = req.body ?? {};
    if (typeof title === 'string') patch.title = title.trim();
    if (typeof author === 'string') patch.author = author.trim();
    if (typeof learningGoal === 'string') patch.learningGoal = learningGoal.trim();
    res.json(store.books.update(req.params.id, patch));
  });

  router.delete('/:id', (req, res) => {
    store.books.delete(req.params.id);
    res.status(204).end();
  });

  return router;
}
