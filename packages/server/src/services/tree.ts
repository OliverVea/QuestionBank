import type { Book, Chapter, Question } from '../domain/types.js';
import type { Store } from '../storage/store.js';

export interface ChapterTree extends Chapter {
  questions: Question[];
}

export interface BookTree extends Book {
  chapters: ChapterTree[];
}

/** Assemble a book with its chapters (ordered) and each chapter's questions, scoped to one customer. */
export async function buildBookTree(
  store: Store,
  customerId: string,
  bookId: string,
): Promise<BookTree | undefined> {
  const book = await store.books.getById(customerId, bookId);
  if (!book) return undefined;

  const allChapters = await store.chapters.getAll(customerId);
  const allQuestions = await store.questions.getAll(customerId);
  const chapters = allChapters
    .filter((c) => c.bookId === bookId)
    .sort((a, b) => a.order - b.order)
    .map<ChapterTree>((c) => ({
      ...c,
      questions: allQuestions.filter((q) => q.chapterId === c.id),
    }));

  return { ...book, chapters };
}
