/** Raw backing for a question — the original image or text it came from. */
export interface QuestionSource {
  kind: 'image' | 'text';
  /** Path under data/images to the original page photo, if kind === 'image'. */
  imagePath?: string;
  /** Plaintext input, if kind === 'text'. */
  rawText?: string;
}

export interface Book {
  id: string;
  title: string;
  author?: string;
  /** Core feature, optional per-book. */
  learningGoal?: string;
  createdAt: string;
}

export interface Chapter {
  id: string;
  bookId: string;
  title: string;
  /** Topics covered; also feeds critique later. */
  description?: string;
  /** Stable display ordering within a book. */
  order: number;
  createdAt: string;
}

export type Relevance = 'essential' | 'relevant' | 'can-skip' | 'should-skip';

export interface Question {
  id: string;
  chapterId: string;
  /** Book's own numbering, e.g. "2.4". */
  label?: string;
  /** LaTeX/markdown — source of truth. */
  canonicalText: string;
  source: QuestionSource;
  /** SRS field — unset by the foundation sub-project. */
  relevance?: Relevance;
  /** SRS live state — unset by the foundation sub-project. */
  nextReviewDate?: string;
  createdAt: string;
}
