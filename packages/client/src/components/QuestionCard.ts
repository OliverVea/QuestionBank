import { html } from '@/lib/html';
import { renderLatex } from '@/lib/latex';
import { appendFigures } from './QuestionFigures';
import './QuestionCard.css';

export interface QuestionCardProps {
  canonicalText: string;
  /** When set, the problem's attached figures are loaded and shown under the text. */
  questionId?: string;
}

/** A styled card with rendered LaTeX content and, optionally, the problem's figures. */
export function QuestionCard({ canonicalText, questionId }: QuestionCardProps): HTMLElement {
  const card = html`<div class="qbody"></div>`;
  renderLatex(card, canonicalText);
  if (questionId !== undefined) void appendFigures(card, questionId);
  return card;
}
