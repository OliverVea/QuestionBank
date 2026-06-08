import type { Book, Chapter, Question } from '../domain/types.js';
import { scheduleFor, type ReviewSchedule } from './srs.js';
import type { Store } from '../storage/store.js';

/** One due review: the question with its book/chapter context and derived schedule. */
export interface DueItem {
  question: Question;
  book: Book;
  chapter: Chapter;
  schedule: ReviewSchedule;
}

/**
 * The questions due for review now: those with at least one attempt whose derived
 * nextReviewDate is at or before `now`, that are not skipped, ordered by nextReviewDate
 * ascending (most overdue first). Schedule is computed on read from attempt history.
 */
export function dueQueue(store: Store, now: string): DueItem[] {
  const attempts = store.attempts.getAll();
  const byQuestion = new Map<string, typeof attempts>();
  for (const a of attempts) {
    const list = byQuestion.get(a.questionId);
    if (list) list.push(a);
    else byQuestion.set(a.questionId, [a]);
  }

  const chapterById = new Map(store.chapters.getAll().map((c) => [c.id, c]));
  const bookById = new Map(store.books.getAll().map((b) => [b.id, b]));

  const items: DueItem[] = [];
  for (const question of store.questions.getAll()) {
    if (question.skipped === true) continue;
    const qAttempts = byQuestion.get(question.id);
    if (qAttempts === undefined) continue; // never attempted → not in the ladder
    const schedule = scheduleFor(qAttempts, now);
    if (schedule === null) continue;
    if (schedule.nextReviewDate > now) continue; // not due yet
    const chapter = chapterById.get(question.chapterId);
    if (chapter === undefined) continue;
    const book = bookById.get(chapter.bookId);
    if (book === undefined) continue;
    items.push({ question, book, chapter, schedule });
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
