import { Router } from 'express';
import { newId, nowIso } from '../domain/ids.js';
import type { Book } from '../domain/types.js';
import { requireCustomerId } from '../auth/index.js';
import { summarizeBooks } from '../services/book-summaries.js';
import { deleteBookCascade } from '../services/cascade.js';
import type { Store } from '../storage/store.js';
import { activeSkippedIds } from './skip.js';

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
    const authorVal = trimmed(author);
    const learningGoalVal = trimmed(learningGoal);
    const isbnVal = trimmed(isbn);
    const publisherVal = trimmed(publisher);
    const book: Book = {
      id: newId(),
      customerId,
      title: title.trim(),
      questionIds: [],
      createdAt: nowIso(),
      ...(authorVal ? { author: authorVal } : {}),
      ...(learningGoalVal ? { learningGoal: learningGoalVal } : {}),
      ...(isbnVal ? { isbn: isbnVal } : {}),
      ...(publisherVal ? { publisher: publisherVal } : {}),
      ...(typeof year === 'number' ? { year } : {}),
    };
    res.status(201).json(await store.books.create(customerId, book));
  });

  router.put('/order', async (req, res) => {
    const customerId = requireCustomerId(req);
    const { bookIds } = req.body ?? {};
    if (!Array.isArray(bookIds) || !bookIds.every((id: unknown) => typeof id === 'string')) {
      res.status(400).json({ error: 'bookIds must be a string array' });
      return;
    }
    // Deduplicate and validate: only keep IDs that belong to this customer.
    const owned = new Set((await store.books.getAll(customerId)).map((b) => b.id));
    const valid = [...new Set(bookIds as string[])].filter((id) => owned.has(id));
    await store.books.reorder(customerId, valid);
    res.status(204).end();
  });

  router.get('/summaries', async (req, res) => {
    const customerId = requireCustomerId(req);
    const [books, questions, attempts, skipped] = await Promise.all([
      store.books.getAll(customerId),
      store.questions.getAll(customerId),
      store.attempts.getAll(customerId),
      activeSkippedIds(store, customerId),
    ]);
    res.json(summarizeBooks(books, questions, attempts, skipped, nowIso()));
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
