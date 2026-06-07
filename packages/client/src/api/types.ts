export interface QuestionSource {
  kind: 'image' | 'text';
  imagePath?: string;
  rawText?: string;
}

export interface Book {
  id: string;
  title: string;
  author?: string;
  learningGoal?: string;
  createdAt: string;
}

export interface Chapter {
  id: string;
  bookId: string;
  title: string;
  description?: string;
  order: number;
  createdAt: string;
}

export interface Question {
  id: string;
  chapterId: string;
  label?: string;
  canonicalText: string;
  source: QuestionSource;
  skipped?: boolean;
  snoozedUntil?: string;
  createdAt: string;
}

export type Grade = 'correct' | 'partial' | 'incorrect';

export type Role = 'user' | 'assistant';
export interface Message {
  role: Role;
  text: string;
}

export interface GradeTurn {
  critiqueText: string;
  recommendedGrade: Grade;
}

export interface TranscribeResult {
  transcription: string;
  imagePaths: string[];
}

export interface Attempt {
  id: string;
  questionId: string;
  imagePaths: string[];
  answerText: string;
  transcription: string;
  recommendedGrade: Grade;
  rating: Grade;
  critiqueText: string;
  createdAt: string;
}

export interface LearnNext {
  question: Question;
  book: Book;
  chapter: Chapter;
}

export interface ChapterTree extends Chapter {
  questions: Question[];
}

export interface BookTree extends Book {
  chapters: ChapterTree[];
}
