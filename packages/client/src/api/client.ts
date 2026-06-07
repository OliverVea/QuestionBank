import type {
  Attempt,
  Book,
  BookTree,
  Chapter,
  Grade,
  GradeTurn,
  LearnNext,
  Message,
  Question,
  TranscribeResult,
} from './types.js';

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
  extractQuestionsFromImage: (chapterId: string, file: File) => {
    const form = new FormData();
    form.append('image', file);
    return fetch(`/api/chapters/${chapterId}/questions/extract`, {
      method: 'POST',
      body: form,
    }).then((r) => json<Question[]>(r));
  },
  updateQuestion: (id: string, patch: Partial<Pick<Question, 'canonicalText' | 'label'>>) =>
    fetch(`/api/questions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => json<Question>(r)),
  deleteQuestion: (id: string) =>
    fetch(`/api/questions/${id}`, { method: 'DELETE' }).then(noContent),

  // Grading & attempts
  retranscribeAnswer: (
    questionId: string,
    body: { imagePaths: string[]; currentTranscription: string; correctionNote: string },
  ) =>
    fetch(`/api/questions/${questionId}/transcribe/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<{ transcription: string }>(r)),
  transcribeAnswer: (questionId: string, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append('images', f);
    return fetch(`/api/questions/${questionId}/transcribe`, { method: 'POST', body: form }).then(
      (r) => json<TranscribeResult>(r),
    );
  },
  gradeTurn: (questionId: string, body: { conversation: Message[] }) =>
    fetch(`/api/questions/${questionId}/grade`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<GradeTurn>(r)),
  createAttempt: (
    questionId: string,
    body: {
      imagePaths: string[];
      answerText: string;
      transcription: string;
      recommendedGrade: Grade;
      rating: Grade;
      critiqueText: string;
    },
  ) =>
    fetch(`/api/questions/${questionId}/attempts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<Attempt>(r)),
  listAttempts: (questionId: string) =>
    fetch(`/api/questions/${questionId}/attempts`).then((r) => json<Attempt[]>(r)),
  patchQuestionState: (id: string, patch: { skipped?: boolean; snoozedUntil?: string | null }) =>
    fetch(`/api/questions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => json<Question>(r)),
  getLearnNext: () =>
    fetch('/api/learn/next').then((r) =>
      json<{ question: Question | null } & Partial<LearnNext>>(r),
    ),
};
