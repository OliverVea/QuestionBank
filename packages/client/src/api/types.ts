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
  createdAt: string;
}

export interface ChapterTree extends Chapter {
  questions: Question[];
}

export interface BookTree extends Book {
  chapters: ChapterTree[];
}
