import { ChatBubble } from './ChatBubble';
import './ThinkingBubble.css';

/** Animated thinking indicator bubble. Returns the element so the caller can remove it when done. */
export function ThinkingBubble(label?: string): HTMLElement {
  const el = ChatBubble('agent');
  el.classList.add('thinking-bubble');
  el.innerHTML =
    '<span class="thinking-dots"><span></span><span></span><span></span></span>' +
    `<span class="thinking-label">${label ?? 'Thinking…'}</span>`;
  return el;
}
