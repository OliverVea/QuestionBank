import { html } from '@/lib/html';
import './TopBar.css';

export interface TopBarProps {
  onBack?: () => void;
  /** Optional right-side element (button, context text, etc.) */
  right?: HTMLElement;
}

export function TopBar({ onBack, right }: TopBarProps = {}): HTMLElement {
  const backBtn = html`<button class="topbar-btn" aria-label="Back">
    <span aria-hidden="true">←</span> Back
  </button>`;
  if (onBack) backBtn.addEventListener('click', onBack);

  const bar = html`<header class="topbar">
    ${backBtn}
    ${right}
  </header>`;

  return bar;
}
