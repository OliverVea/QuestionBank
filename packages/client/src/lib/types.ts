/**
 * Shared client-side domain types, mirroring the server's domain/types.ts.
 *
 * The client has no central fetch wrapper (each page calls `fetch` inline), so
 * these are just the response shapes the attempt-history screens read. Member
 * names match the server exactly — if the API contract changes, change both.
 */

/** Relevance to the book's learning goal. */
export type Relevance = 'high' | 'medium' | 'low';

export type Grade = 'correct' | 'partial' | 'incorrect';
export type Mastery = 'new' | 'improving' | 'strong' | 'excellent';
export type Readiness = 'ready' | 'waiting' | 'finalized';

/** Derived, server-computed status for one problem. */
export interface ProblemSummary {
  mastery: Mastery;
  readiness: Readiness;
  /** Per-attempt grades, oldest first — backs the CI-history strip. */
  grades: Grade[];
  /** ISO date the problem next becomes due — present only when readiness is 'waiting'. */
  nextReviewDate?: string;
}

export type IssueSeverity = 'critical' | 'medium' | 'minor';

export interface GradingIssue {
  severity: IssueSeverity;
  description: string;
}

/** A committed grading attempt, as returned by GET /questions/:id/attempts. */
export interface Attempt {
  id: string;
  questionId: string;
  answer: string;
  recommendedGrade: Grade;
  rating: Grade;
  issues: GradingIssue[];
  createdAt: string;
}

/** A book's problem with its derived summary, from GET /books/:id/questions. */
export interface QuestionWithSummary {
  id: string;
  bookId: string;
  label: string;
  canonicalText: string;
  relevance?: Relevance;
  summary: ProblemSummary;
}

/** A book record, from GET /books/:id. */
export interface Book {
  id: string;
  title: string;
  author?: string;
  isbn?: string;
  publisher?: string;
  year?: number;
}

/** Per-book landing summary, from GET /api/books/summaries. Mirrors the server. */
export interface BookSummary {
  progress: number;
  dueNow: number;
  nextReviewDate: string | null;
  learnNext: { label: string; pathPrefix: string } | null;
}

export type BookWithSummary = Book & { summary: BookSummary };

/** Global activity metrics, from GET /api/activity. Mirrors the server. */
export interface Activity {
  streak: number;
  daysActive: number;
  problemsThisWeek: number;
  daysGoal: number;
  problemsGoal: number;
}
