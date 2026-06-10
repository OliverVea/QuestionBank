import type { Question } from '../domain/types.js';

/**
 * Heal a book's ordered `questionIds` against the questions that actually exist for it.
 *
 * - ids present in `questionIds` AND backed by a surviving question are kept, in order;
 * - ids with no surviving question are dropped (a dangling create that never landed);
 * - questions for this book that are absent from `questionIds` are appended, oldest-first,
 *   so a half-written create surfaces last and never vanishes.
 *
 * Pure and total: the caller (the questions GET) persists the result back to the book.
 */
export function reconcileQuestionIds(questionIds: string[], questions: Question[]): string[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const kept = questionIds.filter((id) => byId.has(id));
  const keptSet = new Set(kept);
  const orphans = questions
    .filter((q) => !keptSet.has(q.id))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
    .map((q) => q.id);
  return [...kept, ...orphans];
}
