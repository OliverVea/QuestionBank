import type { Book, Question } from '../domain/types.js';
import type { Store } from '../storage/store.js';

export interface LearnNext {
  question: Question;
  book: Book;
}

/**
 * The next question to suggest: the first un-attempted question, scanning books in list
 * order and, within each book, in `questionIds` order. `now` is accepted for signature
 * symmetry with the other queues; it is not currently used (skip/snooze are gone — Skip is
 * client-only). Returns undefined when nothing is eligible.
 */
export async function suggestNext(
  store: Store,
  customerId: string,
  _now: string,
): Promise<LearnNext | undefined> {
  const attempted = new Set((await store.attempts.getAll(customerId)).map((a) => a.questionId));
  const books = await store.books.getAll(customerId);
  const questionById = new Map(
    (await store.questions.getAll(customerId)).map((q) => [q.id, q]),
  );

  for (const book of books) {
    for (const id of book.questionIds) {
      const question = questionById.get(id);
      if (question === undefined) continue; // dangling id — reconcile heals it on read
      if (attempted.has(id)) continue;
      return { question, book };
    }
  }
  return undefined;
}
