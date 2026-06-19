import { html } from '@/lib/html';
import { CoverSlot } from '@/components/CoverSlot';
import { daysUntil } from '@/lib/dates';
import type { Book, BookSummary } from '@/lib/types';
import './BookCard.css';

const ICON_REVISIT =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round">
     <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" /><path d="M21 3v5h-5" />
     <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 21v-5h5" />
   </svg>`;
const ICON_LEARN =
  `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z" /></svg>`;

export interface BookCardProps {
  book: Book & { summary: BookSummary };
  onOpen: () => void;
  onRevisit: () => void;
  onLearn: () => void;
}

/** A book is finished when fully mastered and nothing is due or scheduled. */
export function isFinished(s: BookSummary): boolean {
  return s.progress === 100 && s.dueNow === 0 && s.nextReviewDate === null;
}

export function BookCard({ book, onOpen, onRevisit, onLearn }: BookCardProps): HTMLElement {
  const s = book.summary;
  const finished = isFinished(s);

  const cover = CoverSlot({ title: book.title, isbn: book.isbn });

  const progClass = 'bc-progress' + (s.progress === 0 ? ' none' : '') + (s.progress === 100 ? ' complete' : '');
  const head = html`<button type="button" class="bc-head">
    ${cover}
    <div class="bc-text">
      <div class="b-title2"></div>
      <div class="b-author"></div>
    </div>
    <div class="${progClass}">
      <span class="bc-pct"></span><span class="bc-pct-lbl">done</span>
    </div>
  </button>`;
  head.querySelector('.b-title2')!.textContent = book.title;
  head.querySelector('.b-author')!.textContent = book.author ?? '';
  head.querySelector('.bc-pct')!.textContent = `${s.progress}%`;
  head.addEventListener('click', onOpen);

  const card = html`<div class="book-card">${head}</div>`;
  if (finished) card.classList.add('finished');

  // Finished books carry no pills — the green 100% is the whole story.
  if (!finished) {
    const actions = html`<div class="bc-actions"></div>`;
    if (s.dueNow > 0) {
      actions.appendChild(pill('revisit', ICON_REVISIT, `${s.dueNow} to revisit`, onRevisit));
    } else if (s.nextReviewDate !== null) {
      actions.appendChild(pill('revisit-soon', ICON_REVISIT, `Ready in ${daysUntil(s.nextReviewDate)}`, null));
    }
    if (s.learnNext !== null) {
      const verb = s.learnNext.started ? 'Continue with chapter' : 'Start learning chapter';
      actions.appendChild(pill('learn', ICON_LEARN, `${verb} ${s.learnNext.pathPrefix}`, onLearn));
    }
    if (actions.childElementCount > 0) card.appendChild(actions);
  }

  return card;
}

/** A pill chip. Tappable pills are <button>s that stopPropagation (so they don't fire the head). */
function pill(kind: string, icon: string, label: string, onClick: (() => void) | null): HTMLElement {
  const tappable = onClick !== null;
  const el = document.createElement(tappable ? 'button' : 'span');
  el.className = `bc-pill bc-${kind}` + (tappable ? ' tappable' : '');
  if (tappable) {
    (el as HTMLButtonElement).type = 'button';
    el.addEventListener('click', (e) => { e.stopPropagation(); onClick!(); });
  }
  el.innerHTML = `<span class="bc-pill-icon" aria-hidden="true">${icon}</span><span class="bc-pill-text"></span>`;
  el.querySelector('.bc-pill-text')!.textContent = label;
  return el;
}
