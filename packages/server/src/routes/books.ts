import { Router } from 'express';
import { newId, nowIso } from '../domain/ids.js';
import type { Book } from '../domain/types.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import { deleteBookCascade } from '../services/cascade.js';
import type { Store } from '../storage/store.js';

/** Trim a string body field; returns undefined when not a non-empty string. */
function trimmed(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export function booksRouter(store: Store): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await store.books.getAll(requireCustomerId(req)));
  });

  router.post('/', async (req, res) => {
    const customerId = requireCustomerId(req);
    const { title, author, learningGoal, isbn, publisher, year } = req.body ?? {};
    if (typeof title !== 'string' || title.trim() === '') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const book: Book = {
      id: newId(),
      customerId,
      title: title.trim(),
      questionIds: [],
      createdAt: nowIso(),
      ...(trimmed(author) ? { author: trimmed(author) } : {}),
      ...(trimmed(learningGoal) ? { learningGoal: trimmed(learningGoal) } : {}),
      ...(trimmed(isbn) ? { isbn: trimmed(isbn) } : {}),
      ...(trimmed(publisher) ? { publisher: trimmed(publisher) } : {}),
      ...(typeof year === 'number' ? { year } : {}),
    };
    res.status(201).json(await store.books.create(customerId, book));
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
    const { title, author, learningGoal, isbn, publisher, year } = req.body ?? {};
    if (typeof title === 'string') patch.title = title.trim();
    if (typeof author === 'string') patch.author = author.trim();
    if (typeof learningGoal === 'string') patch.learningGoal = learningGoal.trim();
    if (typeof isbn === 'string') patch.isbn = isbn.trim();
    if (typeof publisher === 'string') patch.publisher = publisher.trim();
    if (typeof year === 'number') patch.year = year;
    res.json(await store.books.update(customerId, req.params.id, patch));
  });

  router.delete('/:id', async (req, res) => {
    await deleteBookCascade(store, requireCustomerId(req), req.params.id);
    res.status(204).end();
  });

  return router;
}
