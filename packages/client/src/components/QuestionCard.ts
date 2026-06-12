import { html } from '@/lib/html';
import { renderLatex } from '@/lib/latex';
import './QuestionCard.css';

export interface QuestionCardProps {
  canonicalText: string;
}

/** Pure render component: a styled card with rendered LaTeX content. */
export function QuestionCard({ canonicalText }: QuestionCardProps): HTMLElement {
  const card = html`<div class="qbody"></div>`;
  renderLatex(card, canonicalText);
  return card;
}
