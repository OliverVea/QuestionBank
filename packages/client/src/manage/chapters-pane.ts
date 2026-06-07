import { api } from '../api/client.js';
import type { Book, ChapterTree } from '../api/types.js';

/**
 * Render a book's chapters with an inline add-row.
 * @param host element to render into
 * @param book the book being viewed
 * @param onBack return to the books list
 * @param onOpen drill into a chapter
 */
export async function renderChaptersPane(
  host: HTMLElement,
  book: Book,
  onBack: () => void,
  onOpen: (chapter: ChapterTree) => void,
): Promise<void> {
  host.innerHTML = '';

  const crumb = document.createElement('div');
  crumb.className = 'crumb';
  const back = document.createElement('button');
  back.textContent = '← Books';
  back.addEventListener('click', onBack);
  crumb.appendChild(back);

  const title = document.createElement('h2');
  title.textContent = book.title;

  const list = document.createElement('div');
  list.className = 'list';
  list.textContent = 'loading…';

  host.append(crumb, title, list);

  async function refresh(): Promise<void> {
    const tree = await api.getBookTree(book.id);
    list.innerHTML = '';
    for (const chapter of tree.chapters) {
      const row = document.createElement('div');
      row.className = 'row';

      const open = document.createElement('button');
      open.className = 'link grow';
      open.style.textAlign = 'left';
      const count = chapter.questions.length;
      open.textContent = `${chapter.title} (${count})`;
      open.addEventListener('click', () => onOpen(chapter));

      const del = document.createElement('button');
      del.className = 'link';
      del.textContent = 'delete';
      del.addEventListener('click', async () => {
        await api.deleteChapter(chapter.id);
        await refresh();
      });

      row.append(open, del);
      list.appendChild(row);
    }
  }

  const addRow = document.createElement('div');
  addRow.className = 'add-row';
  const input = document.createElement('input');
  input.placeholder = 'New chapter title…';
  const addBtn = document.createElement('button');
  addBtn.textContent = 'Add';

  async function add(): Promise<void> {
    const t = input.value.trim();
    if (!t) return;
    await api.createChapter(book.id, { title: t });
    input.value = '';
    await refresh();
    input.focus();
  }

  addBtn.addEventListener('click', add);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void add();
  });
  addRow.append(input, addBtn);
  host.appendChild(addRow);

  await refresh();
}
