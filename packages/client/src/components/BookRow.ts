import { html } from '@/lib/html';
import { CoverSlot } from '@/components/CoverSlot';
import './BookRow.css';

export interface BookRowProps {
  title: string;
  author: string | undefined;
  questionCount: number;
  isbn?: string | undefined;
}

export function BookRow(props: BookRowProps): HTMLElement {
  const cover = CoverSlot({ title: props.title, isbn: props.isbn });

  const count = props.questionCount === 1
    ? '1 question'
    : `${props.questionCount} questions`;

  return html`<div class="book">
    ${cover}
    <div class="b-title">${props.title}</div>
    <div class="b-author">${props.author ?? ''}</div>
    <div class="b-count">${count}</div>
  </div>`;
}
