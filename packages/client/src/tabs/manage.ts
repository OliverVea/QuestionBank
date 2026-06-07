import type { Book, ChapterTree } from '../api/types.js';
import { renderBooksPane } from '../manage/books-pane.js';
import { renderChaptersPane } from '../manage/chapters-pane.js';
import { renderQuestionsPane } from '../manage/questions-pane.js';

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
      const current = view;
      void renderQuestionsPane(pane, current.chapter, current.book.title, () => {
        view = { level: 'book', book: current.book };
        show();
      });
    }
  }

  show();
}
