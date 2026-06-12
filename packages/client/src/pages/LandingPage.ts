import { html } from '@/lib/html';
import { Banner } from '@/components/Banner';
import { BookRow } from '@/components/BookRow';
import { Spinner } from '@/components/Spinner';
import './LandingPage.css';

/** Create an SVG icon element. Uses innerHTML directly because the html helper
 *  requires an HTMLElement root but SVG elements are not HTMLElements. */
function svgIcon(svg: string): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.innerHTML = svg;
  return wrapper;
}

/** SVG icon for the revisit banner. */
function revisitIcon(): HTMLElement {
  return svgIcon(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
    stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"></path>
    <path d="M21 3v5h-5"></path>
    <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"></path>
    <path d="M3 21v-5h5"></path>
  </svg>`);
}

/** SVG icon for the learn banner. */
function learnIcon(): HTMLElement {
  return svgIcon(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
    stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 18h6"></path>
    <path d="M10 21h4"></path>
    <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2v.3h6v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2Z"></path>
    <path d="M12 6a3 3 0 0 0-3 3"></path>
  </svg>`);
}

interface Book {
  id: string;
  title: string;
  author?: string;
  isbn?: string;
  questionIds: string[];
}

interface DueCount { count: number }
interface LearnNext { question: { id: string; bookId: string } | null; book?: { title: string } }

export function LandingPage(): HTMLElement {
  const booksHost = html`<div></div>`;
  booksHost.appendChild(Spinner());

  const revisitBanner = Banner({
    colorClass: 'revisit',
    icon: revisitIcon(),
    eyebrow: 'Revisit',
    cta: 'All caught up',
    empty: true,
  });
  revisitBanner.classList.add('animate-in');
  revisitBanner.style.setProperty('--i', '0');

  const learnBanner = Banner({
    colorClass: 'learn',
    icon: learnIcon(),
    eyebrow: 'Learn',
    cta: 'Nothing new right now',
    empty: true,
  });
  learnBanner.classList.add('animate-in');
  learnBanner.style.setProperty('--i', '1');

  const page = html`<div class="landing anim-cascade">
    ${revisitBanner}
    ${learnBanner}
    <section class="library">
      <div class="library-head animate-in" style="--i: 2">
        <h2>Your library</h2>
        <button class="edit-btn" aria-label="Edit library" title="Edit library">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      </div>
      ${booksHost}
      <button class="add-book animate-in" style="--i: 20">
        <span class="plus" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </span>
        <span>Add a book to your library</span>
      </button>
    </section>
  </div>`;

  // Wire navigation
  page.querySelector('.add-book')!.addEventListener('click', () => {
    window.location.hash = '#/add-book';
  });
  page.querySelector('.edit-btn')!.addEventListener('click', () => {
    window.location.hash = '#/manage-books';
  });

  // Fetch data and fill the page.
  void loadData(page, booksHost);

  return page;
}

async function loadData(page: HTMLElement, booksHost: HTMLElement): Promise<void> {
  const [books, due, next] = await Promise.all([
    fetch('/api/books').then(r => r.json() as Promise<Book[]>).catch(() => [] as Book[]),
    fetch('/api/practice/due?count=true').then(r => r.json() as Promise<DueCount>).catch(() => ({ count: 0 })),
    fetch('/api/learn/next').then(r => r.json() as Promise<LearnNext>).catch(() => ({ question: null })),
  ]);

  // Update revisit banner.
  const revisitSlot = page.querySelector('.banner.revisit');
  if (revisitSlot && due.count > 0) {
    const n = due.count;
    const replacement = Banner({
      colorClass: 'revisit',
      icon: revisitIcon(),
      eyebrow: `Revisit: ${n} problem${n === 1 ? '' : 's'} waiting`,
      cta: 'Make it stick',
      onClick: () => { window.location.hash = '#/learn'; },
    });
    replacement.classList.add('animate-in');
    replacement.style.setProperty('--i', '0');
    revisitSlot.replaceWith(replacement);
  }

  // Update learn banner.
  const learnSlot = page.querySelector('.banner.learn');
  if (learnSlot && next.question && next.book) {
    const replacement = Banner({
      colorClass: 'learn',
      icon: learnIcon(),
      eyebrow: `Next up: ${next.book.title}`,
      cta: 'Grow your knowledge',
      onClick: () => { window.location.hash = '#/learn'; },
    });
    replacement.classList.add('animate-in');
    replacement.style.setProperty('--i', '1');
    learnSlot.replaceWith(replacement);
  }

  // Populate book rows with staggered animation.
  booksHost.replaceChildren();
  const ROW_INDEX_OFFSET = 3;
  books.forEach((book, i) => {
    const row = BookRow({
      title: book.title,
      author: book.author,
      questionCount: book.questionIds.length,
      isbn: book.isbn,
    });
    row.classList.add('animate-in');
    row.style.setProperty('--i', String(ROW_INDEX_OFFSET + i));
    booksHost.appendChild(row);
  });

  // Update the add-book button's stagger index to come after all book rows.
  const addBtn = page.querySelector('.add-book') as HTMLElement;
  addBtn.style.setProperty('--i', String(ROW_INDEX_OFFSET + books.length));
}
