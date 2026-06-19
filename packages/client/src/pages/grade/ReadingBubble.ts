// packages/client/src/pages/grade/ReadingBubble.ts
import { ChatBubble } from '@/components/ChatBubble';
import { renderLatex } from '@/lib/latex';

/** A transcription reading shown as a plain agent bubble. */
export function ReadingBubble(text: string): HTMLElement {
  const el = ChatBubble('agent');
  el.classList.add('reading-bubble');

  const label = document.createElement('div');
  label.className = 'reading-label';
  label.textContent = "Here's what I read";
  el.appendChild(label);

  const body = document.createElement('div');
  body.className = 'reading-body';
  renderLatex(body, text, '');
  el.appendChild(body);
  return el;
}
