import type { Book } from '../api/types.js';
import { renderBooksPane } from '../manage/books-pane.js';

type View = { level: 'books' } | { level: 'book'; book: Book };

/** Manage tab — master/detail drill-down (Books → Book → Chapter → Questions). */
export function renderManage(host: HTMLElement): void {
  let view: View = { level: 'books' };

  function show(): void {
    host.innerHTML = '';
    const pane = document.createElement('div');
    host.appendChild(pane);

    if (view.level === 'books') {
      void renderBooksPane(pane, (book) => {
        view = { level: 'book', book };
        show();
      });
    } else {
      renderBookPlaceholder(pane, view.book, () => {
        view = { level: 'books' };
        show();
      });
    }
  }

  show();
}

/** Temporary — replaced by the chapters pane in the next task. */
function renderBookPlaceholder(host: HTMLElement, book: Book, onBack: () => void): void {
  const crumb = document.createElement('div');
  crumb.className = 'crumb';
  const back = document.createElement('button');
  back.textContent = '← Books';
  back.addEventListener('click', onBack);
  crumb.appendChild(back);

  const title = document.createElement('h2');
  title.textContent = book.title;

  host.append(crumb, title);
}
