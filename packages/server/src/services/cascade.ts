import type { Store } from '../storage/store.js';

/** Delete a chapter and every question under it, scoped to one customer. */
export async function deleteChapterCascade(
  store: Store,
  customerId: string,
  chapterId: string,
): Promise<void> {
  for (const q of await store.questions.getAll(customerId)) {
    if (q.chapterId === chapterId) await store.questions.delete(customerId, q.id);
  }
  await store.chapters.delete(customerId, chapterId);
}

/** Delete a book, every chapter under it, and every question under those chapters, scoped to one customer. */
export async function deleteBookCascade(
  store: Store,
  customerId: string,
  bookId: string,
): Promise<void> {
  for (const chapter of await store.chapters.getAll(customerId)) {
    if (chapter.bookId === bookId) await deleteChapterCascade(store, customerId, chapter.id);
  }
  await store.books.delete(customerId, bookId);
}
