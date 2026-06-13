import type { Book, Question } from '../domain/types.js';
import { activeSkippedIds } from '../routes/skip.js';
import { scheduleFor, type ReviewSchedule } from './srs.js';
import type { Store } from '../storage/store.js';

/** One due review: the question with its book context and derived schedule. */
export interface DueItem {
  question: Question;
  book: Book;
  schedule: ReviewSchedule;
}

/**
 * The questions due for review now: those with at least one attempt whose derived
 * nextReviewDate is at or before `now`, ordered by nextReviewDate ascending (most overdue
 * first). Excludes questions with active server-side skips.
 */
export async function dueQueue(store: Store, customerId: string, now: string): Promise<DueItem[]> {
  const attempts = await store.attempts.getAll(customerId);
  const skipped = await activeSkippedIds(store, customerId);
  const byQuestion = new Map<string, typeof attempts>();
  for (const a of attempts) {
    const list = byQuestion.get(a.questionId);
    if (list) list.push(a);
    else byQuestion.set(a.questionId, [a]);
  }

  const bookById = new Map((await store.books.getAll(customerId)).map((b) => [b.id, b]));

  const items: DueItem[] = [];
  for (const question of await store.questions.getAll(customerId)) {
    if (skipped.has(question.id)) continue;
    const qAttempts = byQuestion.get(question.id);
    if (qAttempts === undefined) continue; // never attempted → not in the ladder
    const schedule = scheduleFor(qAttempts, now);
    if (schedule === null) continue;
    if (schedule.nextReviewDate > now) continue; // not due yet
    const book = bookById.get(question.bookId);
    if (book === undefined) continue;
    items.push({ question, book, schedule });
  }

  items.sort((a, b) =>
    a.schedule.nextReviewDate < b.schedule.nextReviewDate
      ? -1
      : a.schedule.nextReviewDate > b.schedule.nextReviewDate
        ? 1
        : 0,
  );
  return items;
}
