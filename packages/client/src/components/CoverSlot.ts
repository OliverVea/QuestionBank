import { html } from '@/lib/html';
import './CoverSlot.css';

export interface CoverSlotProps {
  title: string;
  color?: string;
}

const DEFAULT_COLOR = 'var(--orange-200)';

/**
 * Cover slot: shows a colored fallback tile with the title text.
 * Returns the wrapper element. Call `setImage(url)` on the returned object to swap in a real cover.
 */
export function CoverSlot(props: CoverSlotProps): HTMLElement {
  const color = props.color ?? DEFAULT_COLOR;
  const el = html`<div class="cover-slot"></div>`;

  function renderFallback() {
    const fb = html`<span class="cover-fallback"><span>${props.title || '\u2014'}</span></span>`;
    (fb as HTMLElement).style.background = color;
    el.replaceChildren(fb);
  }

  renderFallback();
  return el;
}
