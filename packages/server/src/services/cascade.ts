import type { Store } from '../storage/store.js';

/**
 * Delete a book and everything under it — its questions and each question's attempts —
 * scoped to one customer. Chapters no longer exist; books own questions directly.
 */
export async function deleteBookCascade(
  store: Store,
  customerId: string,
  bookId: string,
): Promise<void> {
  const questions = (await store.questions.getAll(customerId)).filter((q) => q.bookId === bookId);
  const questionIds = new Set(questions.map((q) => q.id));
  for (const attempt of await store.attempts.getAll(customerId)) {
    if (questionIds.has(attempt.questionId)) {
      await store.attempts.delete(customerId, attempt.id);
    }
  }
  for (const q of questions) {
    await store.questions.delete(customerId, q.id);
  }
  await store.books.delete(customerId, bookId);
}
