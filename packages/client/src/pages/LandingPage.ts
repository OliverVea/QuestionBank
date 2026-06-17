import { html } from '@/lib/html';
import { Spinner } from '@/components/Spinner';
import { ActivityHeader } from '@/components/ActivityHeader';
import { BookCard, isFinished } from '@/components/BookCard';
import type { Activity, BookWithSummary } from '@/lib/types';
import './LandingPage.css';

/**
 * Home screen: a global activity header (streak + weekly goals) over the library
 * of per-book cards (cover + mastery progress + revisit/learn pills). One scrolling
 * region — the header and library scroll together.
 */
export function LandingPage(): HTMLElement {
  const headerHost = html`<div></div>`;
  const booksHost = html`<div></div>`;
  booksHost.appendChild(Spinner());

  const editBtn = html`<button class="edit-btn" aria-label="Edit library" title="Edit library">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
         stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  </button>`;
  editBtn.addEventListener('click', () => { window.location.hash = '#/manage-books'; });

  const settingsBtn = html`<button class="edit-btn" aria-label="Settings" title="Settings">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
         stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  </button>`;
  settingsBtn.addEventListener('click', () => { window.location.hash = '#/settings'; });

  const addBtn = html`<button class="add-book">
    <span class="plus" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 5v14" /><path d="M5 12h14" />
      </svg>
    </span>
    <span>Add a book to your library</span>
  </button>`;
  addBtn.addEventListener('click', () => { window.location.hash = '#/add-book'; });

  const page = html`<div class="landing app anim-cascade">
    <div class="home-scroll">
      ${headerHost}
      <section class="library">
        <div class="library-head">
          <h2>Your library</h2>
          <div class="head-actions">
            ${editBtn}
            ${settingsBtn}
          </div>
        </div>
        ${booksHost}
        ${addBtn}
      </section>
    </div>
  </div>`;

  void loadData(headerHost, booksHost);
  return page;
}

async function loadData(headerHost: HTMLElement, booksHost: HTMLElement): Promise<void> {
  const [activity, books] = await Promise.all([
    fetch('/api/activity').then((r) => r.json() as Promise<Activity>).catch(() => null),
    fetch('/api/books/summaries').then((r) => r.json() as Promise<BookWithSummary[]>).catch(() => [] as BookWithSummary[]),
  ]);

  if (activity) headerHost.replaceChildren(ActivityHeader(activity));
  else headerHost.replaceChildren();

  // Finished books (fully mastered, nothing due) sink to the bottom, stable order.
  const ordered = [...books].sort((a, b) => Number(isFinished(a.summary)) - Number(isFinished(b.summary)));

  booksHost.replaceChildren();
  ordered.forEach((book) => {
    booksHost.appendChild(BookCard({
      book,
      onOpen: () => { window.location.hash = `#/view-book?id=${encodeURIComponent(book.id)}`; },
      onRevisit: () => { window.location.hash = '#/revisit'; },
      onLearn: () => { window.location.hash = '#/learn'; },
    }));
  });
}
