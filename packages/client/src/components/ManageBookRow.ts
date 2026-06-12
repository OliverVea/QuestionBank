import { html } from '@/lib/html';
import { CoverSlot } from '@/components/CoverSlot';
import './ManageBookRow.css';

export interface ManageBookRowProps {
  id: string;
  title: string;
  author: string | undefined;
  isbn: string | undefined;
  onTap: () => void;
  onDelete: () => void;
}

export function ManageBookRow(props: ManageBookRowProps): HTMLElement {
  const cover = CoverSlot({ title: props.title, isbn: props.isbn });

  const handle = html`<span class="m-handle" aria-label="Drag to reorder">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" />
    </svg>
  </span>`;

  const del = html`<button class="m-del" type="button" aria-label="Delete book">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M6 6l1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  </button>`;

  del.addEventListener('click', (e) => { e.stopPropagation(); props.onDelete(); });

  const row = html`<div class="m-book">
    ${handle}
    ${cover}
    <div class="b-title2">${props.title}</div>
    <div class="b-author">${props.author ?? ''}</div>
    ${del}
  </div>`;
  (row as HTMLElement).dataset.bookId = props.id;

  row.addEventListener('click', () => {
    if (row.dataset.dragged) { delete row.dataset.dragged; return; }
    props.onTap();
  });

  return row;
}
