import type { Book, Question } from '../domain/types.js';
import { activeSkippedIds } from '../routes/skip.js';
import { compareProblems } from './problem-order.js';
import type { Store } from '../storage/store.js';

export interface LearnNext {
  question: Question;
  book: Book;
}

/**
 * The next question to suggest: the first un-attempted question, scanning books in list
 * order and, within each book, in DERIVED PATH order (compareProblems) so "what to learn
 * next" follows the book's structure — not the stored questionIds. Returns undefined when
 * nothing is eligible. Excludes questions with active (non-expired) server-side skips.
 */
export async function suggestNext(
  store: Store,
  customerId: string,
  _now: string,
): Promise<LearnNext | undefined> {
  const attempted = new Set((await store.attempts.getAll(customerId)).map((a) => a.questionId));
  const skipped = await activeSkippedIds(store, customerId);
  const books = await store.books.getAll(customerId);
  const allQuestions = await store.questions.getAll(customerId);
  const byBook = new Map<string, Question[]>();
  for (const q of allQuestions) {
    const list = byBook.get(q.bookId);
    if (list) list.push(q);
    else byBook.set(q.bookId, [q]);
  }

  for (const book of books) {
    const ordered = (byBook.get(book.id) ?? []).sort(compareProblems);
    for (const question of ordered) {
      if (attempted.has(question.id)) continue;
      if (skipped.has(question.id)) continue;
      return { question, book };
    }
  }
  return undefined;
}
