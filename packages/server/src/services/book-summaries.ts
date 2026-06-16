import type { Attempt, BookWithSummary, Book, Mastery, Question } from '../domain/types.js';
import { compareProblems } from './problem-order.js';
import { deriveSummary } from './summary.js';

/** Mastery → progress weight; the per-book progress % is the mean × 100. */
const MASTERY_WEIGHT: Record<Mastery, number> = { new: 0, improving: 0.33, strong: 0.66, excellent: 1 };

/**
 * Derive each book's landing summary from already-loaded data (one bulk load by the
 * caller; no per-book rescans). All readiness-derived fields come from the SAME
 * deriveSummary pass per problem, so they cannot disagree with the book-detail view.
 * `now` is an ISO timestamp; `skippedIds` are the currently-active skip question ids.
 */
export function summarizeBooks(
  books: Book[],
  questions: Question[],
  attempts: Attempt[],
  skippedIds: Set<string>,
  now: string,
): BookWithSummary[] {
  const questionsByBook = new Map<string, Question[]>();
  for (const q of questions) {
    const list = questionsByBook.get(q.bookId);
    if (list) list.push(q);
    else questionsByBook.set(q.bookId, [q]);
  }
  const attemptsByQuestion = new Map<string, Attempt[]>();
  for (const a of attempts) {
    const list = attemptsByQuestion.get(a.questionId);
    if (list) list.push(a);
    else attemptsByQuestion.set(a.questionId, [a]);
  }

  return books.map((book) => {
    const bookQuestions = (questionsByBook.get(book.id) ?? []).slice().sort(compareProblems);

    let weightSum = 0;
    let dueNow = 0;
    let earliestNext: string | null = null;
    let learnNext: { label: string; pathPrefix: string } | null = null;

    for (const q of bookQuestions) {
      const qAttempts = attemptsByQuestion.get(q.id) ?? [];
      const summary = deriveSummary(qAttempts, now);
      weightSum += MASTERY_WEIGHT[summary.mastery];

      // "Revisit" means previously seen: a never-attempted problem is 'ready' but is
      // NOT due-for-revisit (it's learn material). Require ≥1 attempt so dueNow matches
      // the revisit queue (dueQueue) the card's pill links to — never-attempted are excluded there.
      if (summary.readiness === 'ready' && qAttempts.length > 0 && !skippedIds.has(q.id)) dueNow += 1;
      if (summary.nextReviewDate && (earliestNext === null || summary.nextReviewDate < earliestNext)) {
        earliestNext = summary.nextReviewDate;
      }
      if (learnNext === null && qAttempts.length === 0) {
        learnNext = { label: q.label, pathPrefix: q.label.split('.')[0] ?? q.label };
      }
    }

    const total = bookQuestions.length;
    const progress = total === 0 ? 0 : Math.round((weightSum / total) * 100);

    return { ...book, summary: { progress, dueNow, nextReviewDate: earliestNext, learnNext } };
  });
}
