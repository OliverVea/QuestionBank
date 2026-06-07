import { api } from '../api/client.js';
import type { Book } from '../api/types.js';

/**
 * Render the list of books with an inline add-row.
 * @param host element to render into
 * @param onOpen called with a book when the user drills into it
 */
export async function renderBooksPane(
  host: HTMLElement,
  onOpen: (book: Book) => void,
): Promise<void> {
  host.innerHTML = '<h2>Books</h2><div class="list">loading…</div>';
  const list = host.querySelector<HTMLDivElement>('.list')!;

  async function refresh(): Promise<void> {
    const books = await api.listBooks();
    list.innerHTML = '';
    for (const book of books) {
      const row = document.createElement('div');
      row.className = 'row';

      const open = document.createElement('button');
      open.className = 'link grow';
      open.style.textAlign = 'left';
      open.textContent = book.title;
      open.addEventListener('click', () => onOpen(book));

      const del = document.createElement('button');
      del.className = 'link';
      del.textContent = 'delete';
      del.addEventListener('click', async () => {
        await api.deleteBook(book.id);
        await refresh();
      });

      row.append(open, del);
      list.appendChild(row);
    }
  }

  const addRow = document.createElement('div');
  addRow.className = 'add-row';
  const input = document.createElement('input');
  input.placeholder = 'New book title…';
  const addBtn = document.createElement('button');
  addBtn.textContent = 'Add';

  async function add(): Promise<void> {
    const title = input.value.trim();
    if (!title) return;
    await api.createBook({ title });
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
