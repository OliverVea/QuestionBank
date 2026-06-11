import { html } from '@/lib/html';
import './TopBar.css';

export interface TopBarProps {
  onBack: () => void;
  right?: HTMLElement;
}

export function TopBar(props: TopBarProps): HTMLElement {
  const el = html`<header class="topbar">
    <button class="topbar-btn" type="button">
      <span aria-hidden="true">\u2190</span> Back
    </button>
  </header>`;

  el.querySelector('.topbar-btn')!.addEventListener('click', props.onBack);
  if (props.right) el.appendChild(props.right);
  return el;
}
