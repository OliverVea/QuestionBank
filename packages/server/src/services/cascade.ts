import type { Store } from '../storage/store.js';

/** Delete a chapter and every question under it. */
export function deleteChapterCascade(store: Store, chapterId: string): void {
  for (const q of store.questions.getAll()) {
    if (q.chapterId === chapterId) store.questions.delete(q.id);
  }
  store.chapters.delete(chapterId);
}

/** Delete a book, every chapter under it, and every question under those chapters. */
export function deleteBookCascade(store: Store, bookId: string): void {
  for (const chapter of store.chapters.getAll()) {
    if (chapter.bookId === bookId) deleteChapterCascade(store, chapter.id);
  }
  store.books.delete(bookId);
}
