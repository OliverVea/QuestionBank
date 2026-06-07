import type { Book, BookTree, Chapter, Question } from './types.js';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function noContent(res: Response): Promise<void> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
}

export const api = {
  // Books
  listBooks: () => fetch('/api/books').then((r) => json<Book[]>(r)),
  getBookTree: (id: string) => fetch(`/api/books/${id}/tree`).then((r) => json<BookTree>(r)),
  createBook: (body: { title: string }) =>
    fetch('/api/books', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<Book>(r)),
  updateBook: (id: string, patch: Partial<Pick<Book, 'title' | 'author' | 'learningGoal'>>) =>
    fetch(`/api/books/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => json<Book>(r)),
  deleteBook: (id: string) => fetch(`/api/books/${id}`, { method: 'DELETE' }).then(noContent),

  // Chapters
  createChapter: (bookId: string, body: { title: string }) =>
    fetch(`/api/books/${bookId}/chapters`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<Chapter>(r)),
  updateChapter: (id: string, patch: Partial<Pick<Chapter, 'title' | 'description' | 'order'>>) =>
    fetch(`/api/chapters/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => json<Chapter>(r)),
  deleteChapter: (id: string) =>
    fetch(`/api/chapters/${id}`, { method: 'DELETE' }).then(noContent),

  // Questions
  createQuestion: (chapterId: string, body: { canonicalText: string; label?: string }) =>
    fetch(`/api/chapters/${chapterId}/questions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<Question>(r)),
  updateQuestion: (id: string, patch: Partial<Pick<Question, 'canonicalText' | 'label'>>) =>
    fetch(`/api/questions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => json<Question>(r)),
  deleteQuestion: (id: string) =>
    fetch(`/api/questions/${id}`, { method: 'DELETE' }).then(noContent),
};
