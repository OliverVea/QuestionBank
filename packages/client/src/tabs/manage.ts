import { api } from '../api/client.js';
import type { Book, ChapterTree } from '../api/types.js';
import { renderBooksPane } from '../manage/books-pane.js';
import { renderChaptersPane } from '../manage/chapters-pane.js';
import { renderQuestionsPane } from '../manage/questions-pane.js';
import type { ManageLocation } from './route.js';

/**
 * Manage tab — master/detail drill-down (Books → Book → Chapter → Questions).
 *
 * The drill-down position lives in the URL hash (`location` arg). Navigation
 * calls `navigate(...)` to update the hash; the shell re-renders us in response.
 * On load we re-hydrate the real objects from the ids via the book tree, falling
 * back gracefully when an id no longer resolves (deleted chapter → its book;
 * deleted book → the books list).
 *
 * @param host element to render into
 * @param location the requested drill-down position, by id
 * @param navigate update the URL hash to a new Manage position
 */
export function renderManage(
  host: HTMLElement,
  location: ManageLocation,
  navigate: (location: ManageLocation) => void,
): void {
  host.innerHTML = '';
  const pane = document.createElement('div');
  host.appendChild(pane);

  // Top level — no hydration needed.
  if (location.bookId === undefined) {
    void renderBooksPane(pane, (book) => navigate({ bookId: book.id }));
    return;
  }

  // Deeper levels need the book tree; hydrate, then render (or fall back).
  pane.textContent = 'loading…';
  void hydrateAndRender(pane, location, navigate);
}

async function hydrateAndRender(
  pane: HTMLElement,
  location: ManageLocation,
  navigate: (location: ManageLocation) => void,
): Promise<void> {
  const bookId = location.bookId!;

  let tree: Awaited<ReturnType<typeof api.getBookTree>>;
  try {
    tree = await api.getBookTree(bookId);
  } catch {
    // Unknown/deleted book → fall back to the books list.
    navigate({});
    return;
  }

  const book: Book = {
    id: tree.id,
    title: tree.title,
    createdAt: tree.createdAt,
    ...(tree.author !== undefined ? { author: tree.author } : {}),
    ...(tree.learningGoal !== undefined ? { learningGoal: tree.learningGoal } : {}),
  };

  // Chapter level requested — find it, else fall back to the book.
  if (location.chapterId !== undefined) {
    const chapter = tree.chapters.find((c) => c.id === location.chapterId);
    if (chapter) {
      renderChapterLevel(pane, book, chapter, navigate);
      return;
    }
    navigate({ bookId });
    return;
  }

  renderBookLevel(pane, book, navigate);
}

function renderBookLevel(
  pane: HTMLElement,
  book: Book,
  navigate: (location: ManageLocation) => void,
): void {
  pane.innerHTML = '';
  void renderChaptersPane(
    pane,
    book,
    () => navigate({}),
    (chapter: ChapterTree) => navigate({ bookId: book.id, chapterId: chapter.id }),
  );
}

function renderChapterLevel(
  pane: HTMLElement,
  book: Book,
  chapter: ChapterTree,
  navigate: (location: ManageLocation) => void,
): void {
  pane.innerHTML = '';
  void renderQuestionsPane(pane, chapter, book.title, () => navigate({ bookId: book.id }));
}
