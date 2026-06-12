import { html } from '@/lib/html';
import './ReplyRow.css';

export interface ReplyRowHandle {
  el: HTMLElement;
  focus(): void;
  disable(): void;
  enable(): void;
}

/** Reply row: auto-growing textarea + send button pill. Enter to send, Shift+Enter for newline. */
export function ReplyRow(opts: { placeholder?: string; onSend: (text: string) => void }): ReplyRowHandle {
  const input = document.createElement('textarea');
  input.className = 'reply-input';
  input.rows = 1;
  input.placeholder = opts.placeholder ?? 'Type a message…';

  const sendBtn = html`<button class="reply-send" type="button" aria-label="Send">→</button>`;

  function send() {
    const text = input.value.trim();
    if (!text) return;
    opts.onSend(text);
    input.value = '';
    input.style.height = 'auto';
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  const el = html`<div class="reply-row">${input}${sendBtn}</div>`;

  return {
    el,
    focus() { input.focus(); },
    disable() { (input as HTMLTextAreaElement).disabled = true; (sendBtn as HTMLButtonElement).disabled = true; },
    enable() { (input as HTMLTextAreaElement).disabled = false; (sendBtn as HTMLButtonElement).disabled = false; },
  };
}
