import type { Store } from '../storage/store.js';

/**
 * Delete the figures (rows + crop blobs) of the given questions, scoped to one customer.
 * Row first, then blob (a crash leaves at worst an orphan blob, never a row pointing at a
 * missing file). Awaited sequentially — the single-writer store must not race blob deletes
 * against the JSON flush. Used by BOTH question-deletion paths (book cascade + batch save);
 * any new deletion path MUST call this or figures leak.
 */
export async function deleteFiguresForQuestions(
  store: Store,
  customerId: string,
  questionIds: Iterable<string>,
): Promise<void> {
  const doomed = new Set(questionIds);
  if (doomed.size === 0) return;
  const figures = (await store.figures.getAll(customerId)).filter((f) =>
    doomed.has(f.questionId),
  );
  for (const fig of figures) {
    await store.figures.delete(customerId, fig.id);
    await store.figureBlobs.delete(fig.id).catch(() => {});
  }
}

/**
 * Delete a book and everything under it — its questions, each question's attempts, and each
 * question's figures (rows + crops) — scoped to one customer. Chapters no longer exist;
 * books own questions directly.
 */
export async function deleteBookCascade(
  store: Store,
  customerId: string,
  bookId: string,
): Promise<void> {
  const questions = (await store.questions.getAll(customerId)).filter((q) => q.bookId === bookId);
  const questionIds = new Set(questions.map((q) => q.id));
  await deleteFiguresForQuestions(store, customerId, questionIds);
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
