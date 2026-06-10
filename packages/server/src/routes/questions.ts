import { Router } from 'express';
import { newId, nowIso } from '../domain/ids.js';
import type { Question } from '../domain/types.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import { planBatchSave, type IncomingQuestion } from '../services/batch-save.js';
import { reconcileQuestionIds } from '../services/reconcile.js';
import type { Store } from '../storage/store.js';

/** Order a book's questions by its (reconciled) questionIds; ids map 1:1 to questions. */
function orderByIds(ids: string[], questions: Question[]): Question[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  return ids.map((id) => byId.get(id)).filter((q): q is Question => q !== undefined);
}

/** Validate the PUT body into IncomingQuestion[]; returns undefined on any malformed item. */
function parseIncoming(raw: unknown): IncomingQuestion[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: IncomingQuestion[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return undefined;
    const { id, label, canonicalText } = item as Record<string, unknown>;
    if (typeof canonicalText !== 'string' || canonicalText.trim() === '') return undefined;
    if (typeof label !== 'string' || label.trim() === '') return undefined;
    if (id !== undefined && typeof id !== 'string') return undefined;
    out.push({
      label: label.trim(),
      canonicalText: canonicalText.trim(),
      ...(typeof id === 'string' ? { id } : {}),
    });
  }
  return out;
}

/** Nested under /api/books/:bookId/questions — reconciled list + atomic batch save. */
export function bookQuestionsRouter(store: Store): Router {
  const router = Router({ mergeParams: true });

  router.get('/', async (req, res) => {
    const customerId = requireCustomerId(req);
    const bookId = (req.params as { bookId: string }).bookId;
    const book = await store.books.getById(customerId, bookId);
    if (!book) {
      res.status(404).json({ error: 'book not found' });
      return;
    }
    const questions = (await store.questions.getAll(customerId)).filter((q) => q.bookId === bookId);
    const healed = reconcileQuestionIds(book.questionIds, questions);
    // Self-heal: persist the reconciled order back so the list converges on read.
    const same =
      healed.length === book.questionIds.length &&
      healed.every((id, i) => id === book.questionIds[i]);
    if (!same) {
      await store.books.update(customerId, bookId, { questionIds: healed });
    }
    res.json(orderByIds(healed, questions));
  });

  router.put('/', async (req, res) => {
    const customerId = requireCustomerId(req);
    const bookId = (req.params as { bookId: string }).bookId;
    if (!(await store.books.getById(customerId, bookId))) {
      res.status(404).json({ error: 'book not found' });
      return;
    }
    const incoming = parseIncoming((req.body ?? {}).questions);
    if (incoming === undefined) {
      res
        .status(400)
        .json({ error: 'questions must be an array of {label, canonicalText, id?}' });
      return;
    }
    const stored = (await store.questions.getAll(customerId)).filter((q) => q.bookId === bookId);
    const plan = planBatchSave({ incoming, stored, bookId, customerId, newId, nowIso });

    // Apply the diff, then commit the new order to the book. Single-writer store, so this
    // sequence is effectively atomic (no concurrent writer can interleave).
    if (plan.deleteIds.length > 0) {
      const doomed = new Set(plan.deleteIds);
      for (const attempt of await store.attempts.getAll(customerId)) {
        if (doomed.has(attempt.questionId)) await store.attempts.delete(customerId, attempt.id);
      }
      for (const id of plan.deleteIds) await store.questions.delete(customerId, id);
    }
    for (const q of plan.create) await store.questions.create(customerId, q);
    for (const u of plan.update) {
      await store.questions.update(customerId, u.id, {
        label: u.label,
        canonicalText: u.canonicalText,
      });
    }
    await store.books.update(customerId, bookId, { questionIds: plan.questionIds });

    const saved = (await store.questions.getAll(customerId)).filter((q) => q.bookId === bookId);
    res.json(orderByIds(plan.questionIds, saved));
  });

  return router;
}

/** Flat /api/questions/:id — single-problem read. */
export function questionsRouter(store: Store): Router {
  const router = Router();

  router.get('/:id', async (req, res) => {
    const question = await store.questions.getById(requireCustomerId(req), req.params.id);
    if (!question) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(question);
  });

  return router;
}
