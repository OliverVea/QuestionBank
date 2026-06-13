/** Raw backing for a question — the original image or text it came from. No image is persisted (TODO 3e). */
export interface QuestionSource {
  kind: 'image' | 'text';
  /** Plaintext input, if kind === 'text'. */
  rawText?: string;
}

export interface Book {
  id: string;
  /** Owning customer — every entity is scoped to one. */
  customerId: string;
  title: string;
  author?: string;
  /** Core feature, optional per-book. */
  learningGoal?: string;
  /** Enables cover resolution (client-side) + metadata re-lookup. */
  isbn?: string;
  publisher?: string;
  year?: number;
  /** Ordered ids of this book's problems — the array position IS the order AND membership. */
  questionIds: string[];
  createdAt: string;
}

/** Relevance to the book's learning goal. */
export type Relevance = 'high' | 'medium' | 'low';

export interface Question {
  id: string;
  /** Owning customer. */
  customerId: string;
  /** Owning book (re-rooted from chapterId). Order lives on the book, not here. */
  bookId: string;
  /** Required; defaults to the 1-based index, editable to a custom value like "1.A.3". */
  label: string;
  /** LaTeX/markdown — source of truth. */
  canonicalText: string;
  /** How relevant this question is to the book's learning goal. */
  relevance?: Relevance;
  source: QuestionSource;
  createdAt: string;
}

/** Grade vocabulary. `partial` ⇒ the answer is ≥70% of the way there. */
export type Grade = 'correct' | 'partial' | 'incorrect';

/** Severity of one issue the grader found; the grade is derived from these. */
export type IssueSeverity = 'critical' | 'medium' | 'minor';

/** One problem the grader flagged with the student's answer. */
export interface GradingIssue {
  severity: IssueSeverity;
  description: string;
}

/** A committed grading attempt — final state only; the in-flight chat is not stored. */
export interface Attempt {
  id: string;
  /** Owning customer. */
  customerId: string;
  questionId: string;
  /** The user's answer as one block of inline-LaTeX text (photo-confirmed or typed). */
  answer: string;
  /** Grade derived from the final issue list. */
  recommendedGrade: Grade;
  /** User's final decision (accept or override). */
  rating: Grade;
  /** The issues the grader flagged on the final turn (empty ⇒ correct). */
  issues: GradingIssue[];
  createdAt: string;
}

/** A temporary skip — question is excluded from suggestion for 12 hours. */
export interface Skip {
  id: string;
  customerId: string;
  questionId: string;
  createdAt: string;
  /** ISO timestamp when this skip expires and the question becomes eligible again. */
  expiresAt: string;
}

/** Mastery word — how well a problem is known, derived from recent grade history. */
export type Mastery = 'new' | 'improving' | 'strong' | 'excellent';

/** Readiness — drives the badge color. ready = act now (purple), waiting = resting (grey), finalized = graduated (green). */
export type Readiness = 'ready' | 'waiting' | 'finalized';

/** Derived, never-persisted status for one problem — computed from its attempts. */
export interface ProblemSummary {
  mastery: Mastery;
  readiness: Readiness;
  /** Per-attempt grades, oldest first — backs the CI-history strip. */
  grades: Grade[];
}

/** A question plus its derived summary, as returned by the book-questions list. */
export type QuestionWithSummary = Question & { summary: ProblemSummary };
