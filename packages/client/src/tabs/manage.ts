import type { Book, ChapterTree } from '../api/types.js';
import { renderBooksPane } from '../manage/books-pane.js';
import { renderChaptersPane } from '../manage/chapters-pane.js';

type View =
  | { level: 'books' }
  | { level: 'book'; book: Book }
  | { level: 'chapter'; book: Book; chapter: ChapterTree };

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
    } else if (view.level === 'book') {
      const current = view;
      void renderChaptersPane(
        pane,
        current.book,
        () => {
          view = { level: 'books' };
          show();
        },
        (chapter) => {
          view = { level: 'chapter', book: current.book, chapter };
          show();
        },
      );
    } else {
      renderChapterPlaceholder(pane, view.book, view.chapter, () => {
        view = { level: 'book', book: (view as { book: Book }).book };
        show();
      });
    }
  }

  show();
}

function renderChapterPlaceholder(
  host: HTMLElement,
  book: Book,
  chapter: ChapterTree,
  onBack: () => void,
): void {
  const crumb = document.createElement('div');
  crumb.className = 'crumb';
  const back = document.createElement('button');
  back.textContent = `← ${book.title}`;
  back.addEventListener('click', onBack);
  crumb.appendChild(back);

  const title = document.createElement('h2');
  title.textContent = chapter.title;

  host.append(crumb, title);
}
