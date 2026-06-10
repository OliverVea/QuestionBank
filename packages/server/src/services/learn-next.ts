import type { Book, Chapter, Question } from '../domain/types.js';
import type { Store } from '../storage/store.js';

export interface LearnNext {
  question: Question;
  book: Book;
  chapter: Chapter;
}

/**
 * The next question to suggest: un-attempted, not skipped, not actively snoozed,
 * ordered by book order → chapter.order → question.createdAt. `now` is passed in so
 * the query is pure/testable. Returns undefined when nothing is eligible.
 */
export async function suggestNext(
  store: Store,
  customerId: string,
  now: string,
): Promise<LearnNext | undefined> {
  const attempted = new Set((await store.attempts.getAll(customerId)).map((a) => a.questionId));
  const books = await store.books.getAll(customerId);
  const bookOrder = new Map(books.map((b, i) => [b.id, i]));
  const chapterById = new Map((await store.chapters.getAll(customerId)).map((c) => [c.id, c]));

  const eligible = (await store.questions.getAll(customerId)).filter((q) => {
    if (attempted.has(q.id)) return false;
    if (q.skipped === true) return false;
    if (q.snoozedUntil !== undefined && q.snoozedUntil > now) return false;
    return chapterById.has(q.chapterId);
  });

  eligible.sort((a, b) => {
    const ca = chapterById.get(a.chapterId)!;
    const cb = chapterById.get(b.chapterId)!;
    const boa = bookOrder.get(ca.bookId) ?? Number.MAX_SAFE_INTEGER;
    const bob = bookOrder.get(cb.bookId) ?? Number.MAX_SAFE_INTEGER;
    if (boa !== bob) return boa - bob;
    if (ca.order !== cb.order) return ca.order - cb.order;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });

  const question = eligible[0];
  if (question === undefined) return undefined;
  const chapter = chapterById.get(question.chapterId)!;
  const book = books.find((b) => b.id === chapter.bookId);
  if (book === undefined) return undefined;
  return { question, book, chapter };
}
