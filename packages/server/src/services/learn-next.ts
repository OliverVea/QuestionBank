import type { Book, Question } from '../domain/types.js';
import { activeSkippedIds } from '../routes/skip.js';
import type { Store } from '../storage/store.js';

export interface LearnNext {
  question: Question;
  book: Book;
}

/**
 * The next question to suggest: the first un-attempted question, scanning books in list
 * order and, within each book, in `questionIds` order. Returns undefined when nothing is
 * eligible. Excludes questions with active (non-expired) server-side skips.
 */
export async function suggestNext(
  store: Store,
  customerId: string,
  _now: string,
): Promise<LearnNext | undefined> {
  const attempted = new Set((await store.attempts.getAll(customerId)).map((a) => a.questionId));
  const skipped = await activeSkippedIds(store, customerId);
  const books = await store.books.getAll(customerId);
  const questionById = new Map(
    (await store.questions.getAll(customerId)).map((q) => [q.id, q]),
  );

  for (const book of books) {
    for (const id of book.questionIds) {
      if (attempted.has(id)) continue;
      if (skipped.has(id)) continue;
      const question = questionById.get(id);
      if (question === undefined) continue;
      return { question, book };
    }
  }
  return undefined;
}
