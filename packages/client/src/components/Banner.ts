import { html } from '@/lib/html';
import './Banner.css';

export interface BannerProps {
  colorClass: string;
  icon: HTMLElement;
  eyebrow: string;
  cta: string;
  empty?: boolean;
  onClick?: () => void;
}

export function Banner(props: BannerProps): HTMLElement {
  const ctaContent = props.empty
    ? html`<span class="b-cta">${props.cta}</span>`
    : html`<span class="b-cta">${props.cta}<span class="b-arrow" aria-hidden="true">→</span></span>`;

  const el = html`<button class="banner">
    <span class="b-icon" aria-hidden="true">${props.icon}</span>
    <span class="b-text">
      <span class="b-eyebrow">${props.eyebrow}</span>
      ${ctaContent}
    </span>
  </button>`;

  el.classList.add(props.colorClass);
  if (props.empty) el.classList.add('empty');

  if (props.onClick && !props.empty) {
    el.addEventListener('click', props.onClick);
  }

  return el;
}
