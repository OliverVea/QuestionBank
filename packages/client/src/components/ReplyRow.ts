// packages/client/src/components/ReplyRow.ts
import { html } from '@/lib/html';
import './ReplyRow.css';

export interface ReplyRowHandle {
  el: HTMLElement;
  focus(): void;
  disable(): void;
  enable(): void;
  /** Compose-while-busy: lock only the send button; textarea stays editable. */
  setSending(busy: boolean): void;
  setPlaceholder(text: string): void;
}

/** Reply row: auto-growing textarea + send button. Enter to send, Shift+Enter for newline. */
export function ReplyRow(opts: { placeholder?: string; onSend: (text: string) => void }): ReplyRowHandle {
  const input = document.createElement('textarea');
  input.className = 'reply-input';
  input.rows = 1;
  input.placeholder = opts.placeholder ?? 'Type a message…';

  const sendBtn = html`<button class="reply-send" type="button" aria-label="Send">→</button>`;
  const send_ = sendBtn as HTMLButtonElement;

  function send() {
    if (send_.disabled) return;
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
    disable() { input.disabled = true; send_.disabled = true; },
    enable() { input.disabled = false; send_.disabled = false; },
    setSending(busy: boolean) { send_.disabled = busy; },
    setPlaceholder(text: string) { input.placeholder = text; },
  };
}
