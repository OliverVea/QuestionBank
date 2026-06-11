import { html } from '@/lib/html';
import './BookRow.css';

export interface BookRowProps {
  title: string;
  author: string | undefined;
  questionCount: number;
}

const ORANGE_STEPS = ['--orange-200', '--orange-300', '--orange-400', '--orange-500'];

function titleColor(title: string): string {
  const norm = title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  let hash = 0;
  for (const ch of norm) {
    hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  }
  return `var(${ORANGE_STEPS[hash % ORANGE_STEPS.length]})`;
}

export function BookRow(props: BookRowProps): HTMLElement {
  const fallback = html`<span class="b-cover-fallback"><span>${props.title}</span></span>`;
  (fallback as HTMLElement).style.background = titleColor(props.title);

  const count = props.questionCount === 1
    ? '1 question'
    : `${props.questionCount} questions`;

  return html`<div class="book">
    ${fallback}
    <div class="b-title">${props.title}</div>
    <div class="b-author">${props.author ?? ''}</div>
    <div class="b-count">${count}</div>
  </div>`;
}
