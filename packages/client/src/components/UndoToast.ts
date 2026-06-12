import { html } from '@/lib/html';
import './UndoToast.css';

export interface UndoToastHandle {
  el: HTMLElement;
  show(message: string, onUndo: () => void): void;
  hide(): void;
}

export function UndoToast(): UndoToastHandle {
  const msg = html`<span class="toast-msg"></span>`;
  const undoBtn = html`<button class="toast-action" type="button">Undo</button>`;
  const el = html`<div class="toast" role="status" aria-live="polite" hidden>
    ${msg}
    ${undoBtn}
  </div>`;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingUndo: (() => void) | null = null;

  function hide() {
    el.hidden = true;
    el.classList.remove('show');
    pendingUndo = null;
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function show(message: string, onUndo: () => void) {
    pendingUndo = onUndo;
    msg.textContent = message;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('show'));
    if (timer) clearTimeout(timer);
    timer = setTimeout(hide, 5000);
  }

  undoBtn.addEventListener('click', () => {
    const fn = pendingUndo;
    hide();
    if (fn) fn();
  });

  return { el, show, hide };
}
