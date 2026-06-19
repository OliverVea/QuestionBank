// packages/client/src/components/PhotoBubble.ts
import { ChatBubble } from './ChatBubble';
import './PhotoBubble.css';

/** Photo thumbnails shown as a user chat bubble. */
export function PhotoBubble(files: File[], opts: { notes?: string } = {}): HTMLElement {
  const el = ChatBubble('user');
  el.classList.add('photo-bubble');
  files.forEach((file, i) => {
    const img = document.createElement('img');
    img.className = 'photo-thumb';
    const url = URL.createObjectURL(file);
    img.src = url;
    img.alt = files.length > 1 ? `Your solution, photo ${i + 1} of ${files.length}` : 'Your solution';
    img.addEventListener('load', () => URL.revokeObjectURL(url));
    el.appendChild(img);
  });
  if (opts.notes) {
    const note = document.createElement('div');
    note.className = 'photo-notes-text';
    note.textContent = opts.notes;
    el.appendChild(note);
  }
  return el;
}
