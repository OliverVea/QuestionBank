import './ChatBubble.css';

/** Base chat bubble: user (right, orange tint) or agent (left, neutral surface). */
export function ChatBubble(kind: 'user' | 'agent', ...children: Node[]): HTMLElement {
  const el = document.createElement('div');
  el.className = `chat-bubble chat-bubble-${kind}`;
  el.append(...children);
  return el;
}
