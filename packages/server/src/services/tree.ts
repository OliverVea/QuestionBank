import type { Book, Chapter, Question } from '../domain/types.js';
import type { Store } from '../storage/store.js';

export interface ChapterTree extends Chapter {
  questions: Question[];
}

export interface BookTree extends Book {
  chapters: ChapterTree[];
}

/** Assemble a book with its chapters (ordered) and each chapter's questions. */
export function buildBookTree(store: Store, bookId: string): BookTree | undefined {
  const book = store.books.getById(bookId);
  if (!book) return undefined;

  const chapters = store.chapters
    .getAll()
    .filter((c) => c.bookId === bookId)
    .sort((a, b) => a.order - b.order)
    .map<ChapterTree>((c) => ({
      ...c,
      questions: store.questions.getAll().filter((q) => q.chapterId === c.id),
    }));

  return { ...book, chapters };
}
