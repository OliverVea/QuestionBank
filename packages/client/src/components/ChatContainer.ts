// packages/client/src/components/ChatContainer.ts
import { html } from '@/lib/html';
import './ChatContainer.css';

export interface ChatContainerHandle {
  el: HTMLElement;
  append(node: Node): void;
  clear(): void;
  scrollToTop(): void;
  scrollToBottom(): void;
  scrollToNode(node: HTMLElement): void;
}

/** Scrollable chat message area with append + scroll utilities. */
export function ChatContainer(): ChatContainerHandle {
  const el = html`<main class="chat-container"></main>`;
  return {
    el,
    append(node: Node) {
      el.appendChild(node);
      el.scrollTop = el.scrollHeight;
    },
    clear() { el.replaceChildren(); },
    scrollToTop() { el.scrollTop = 0; },
    scrollToBottom() { el.scrollTo?.({ top: el.scrollHeight, behavior: 'smooth' }); },
    // Land the top of a reply in view (so a long reply reads from its start)
    // instead of dropping past it. Small offset for breathing room.
    scrollToNode(node: HTMLElement) {
      el.scrollTo?.({ top: Math.max(0, node.offsetTop - 8), behavior: 'smooth' });
    },
  };
}
