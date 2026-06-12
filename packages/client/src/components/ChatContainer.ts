import { html } from '@/lib/html';
import './ChatContainer.css';

export interface ChatContainerHandle {
  el: HTMLElement;
  append(node: Node): void;
  scrollToBottom(): void;
}

/** Scrollable chat message area with append + auto-scroll utility. */
export function ChatContainer(): ChatContainerHandle {
  const el = html`<main class="chat-container"></main>`;
  return {
    el,
    append(node: Node) {
      el.appendChild(node);
      el.scrollTop = el.scrollHeight;
    },
    scrollToBottom() { el.scrollTop = el.scrollHeight; },
  };
}
