import { html } from '@/lib/html';
import './CoverSlot.css';

export interface CoverSlotProps {
  title?: string;
  isbn?: string | undefined;
}

/** Deterministic color from a string (title or fallback). */
function colorFromTitle(title: string): string {
  const colors = ['var(--orange-200)', 'var(--orange-300)', 'var(--orange-400)', 'var(--orange-500)'];
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = ((hash << 5) - hash + title.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length]!;
}

export function CoverSlot({ title, isbn }: CoverSlotProps = {}): HTMLElement {
  const slot = html`<div class="cover-slot"></div>`;

  // Render fallback tile immediately.
  const fallback = document.createElement('span');
  fallback.className = 'cover-fallback';
  fallback.style.background = colorFromTitle(title || 'Book');
  const inner = document.createElement('span');
  inner.className = 'cover-fallback-text';
  inner.textContent = (title || 'Book').slice(0, 20);
  fallback.appendChild(inner);
  slot.appendChild(fallback);

  // If ISBN given, attempt to load a real cover from Open Library.
  if (isbn) {
    const img = new Image();
    img.className = 'cover-img';
    img.alt = title || 'Book cover';
    img.src = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`;
    img.onload = () => { slot.replaceChildren(img); };
    // On error, keep the fallback (no-op).
  }

  return slot;
}
