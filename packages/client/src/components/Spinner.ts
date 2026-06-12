import { html } from '@/lib/html';
import './Spinner.css';

export function Spinner(): HTMLElement {
  return html`<div class="page-spinner"><div class="page-spinner-ring"></div></div>`;
}
