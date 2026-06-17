import type { Book, Question, Relevance } from '../domain/types.js';
import { activeSkippedIds } from '../routes/skip.js';
import { compareProblems } from './problem-order.js';
import type { Store } from '../storage/store.js';

export interface LearnNext {
  question: Question;
  book: Book;
}

/**
 * Relevance rank for ordering: high learns before medium before low. A question with no
 * stored relevance is treated as medium — neither prioritized nor postponed (TODO 7d).
 */
const RELEVANCE_RANK: Record<Relevance, number> = { high: 0, medium: 1, low: 2 };
function relevanceRank(q: Question): number {
  return RELEVANCE_RANK[q.relevance ?? 'medium'];
}

/**
 * The next question to suggest: the most-relevant un-attempted question, scanning books in
 * list order and, within each book, ordered by relevance (high→medium→low) and then DERIVED
 * PATH order (compareProblems) as the tiebreak. Low-relevance questions are thus postponed
 * until every higher-relevance question in the book is attempted (TODO 7d). Returns undefined
 * when nothing is eligible. Excludes questions with active (non-expired) server-side skips.
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
    const eligible = (byBook.get(book.id) ?? []).filter(
      (q) => !attempted.has(q.id) && !skipped.has(q.id),
    );
    if (eligible.length === 0) continue;
    // Relevance is the primary key so a high-relevance question outranks a lower one earlier
    // in the path; compareProblems (derived path) breaks ties within a relevance band.
    eligible.sort((a, b) => relevanceRank(a) - relevanceRank(b) || compareProblems(a, b));
    return { question: eligible[0]!, book };
  }
  return undefined;
}
