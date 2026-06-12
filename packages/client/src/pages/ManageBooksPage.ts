import { html } from '@/lib/html';
import { TopBar } from '@/components/TopBar';
import { ManageBookRow } from '@/components/ManageBookRow';
import { UndoToast } from '@/components/UndoToast';
import { Spinner } from '@/components/Spinner';
import './ManageBooksPage.css';

interface Book {
  id: string;
  title: string;
  author?: string;
  isbn?: string;
  questionIds: string[];
}

export function ManageBooksPage(): HTMLElement {
  const booksHost = html`<div class="manage-list"></div>`;
  const spinner = Spinner();
  booksHost.appendChild(spinner);
  const emptyState = html`<p class="manage-empty" hidden>No books yet.</p>`;
  const toast = UndoToast();

  // Track pending delete so we can serialize vs reorder.
  let pendingDeleteId: string | null = null;
  let pendingDeleteTimer: ReturnType<typeof setTimeout> | null = null;

  const page = html`<div class="manage-page anim-cascade">
    ${TopBar({ onBack: () => { window.location.hash = '#/'; } })}
    <section class="manage">
      <div class="manage-head animate-in" style="--i: 0">
        <h1>Manage library</h1>
      </div>
      ${emptyState}
      ${booksHost}
    </section>
    ${toast.el}
  </div>`;

  void loadBooks();
  
  // Clean up pending timers when the page is unmounted.
  const observer = new MutationObserver(() => {
    if (!document.contains(page)) {
      if (pendingDeleteTimer) { clearTimeout(pendingDeleteTimer); finalizePendingDelete(); }
      toast.hide();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return page;

  async function loadBooks() {
    const books: Book[] = await fetch('/api/books').then((r) => r.json()).catch(() => []);
    spinner.remove();
    if (books.length === 0) {
      emptyState.hidden = false;
      booksHost.hidden = true;
      return;
    }
    emptyState.hidden = true;
    booksHost.hidden = false;

    books.forEach((book, i) => {
      const row = ManageBookRow({
        id: book.id,
        title: book.title,
        author: book.author,
        isbn: book.isbn,
        onTap: () => { window.location.hash = `#/edit-book?id=${book.id}`; },
        onDelete: () => deleteBook(book, row),
      });
      row.classList.add('animate-in');
      row.style.setProperty('--i', String(1 + i));
      booksHost.appendChild(row);

      // Wire drag-reorder on the handle.
      const handle = row.querySelector('.m-handle') as HTMLElement;
      if (handle) makeDraggable(row, handle);
    });
  }

  function deleteBook(book: Book, row: HTMLElement) {
    // If another delete is pending, finalize it immediately.
    if (pendingDeleteId) finalizePendingDelete();

    const anchor = row.nextElementSibling;
    row.remove();
    pendingDeleteId = book.id;

    // Show empty state if list is now empty.
    if (!booksHost.querySelector('.m-book')) emptyState.hidden = false;

    toast.show(`"${book.title}" deleted`, () => {
      // Undo: re-insert row.
      pendingDeleteId = null;
      if (pendingDeleteTimer) { clearTimeout(pendingDeleteTimer); pendingDeleteTimer = null; }
      if (anchor && anchor.parentNode === booksHost) booksHost.insertBefore(row, anchor);
      else booksHost.appendChild(row);
      emptyState.hidden = true;
    });

    pendingDeleteTimer = setTimeout(() => finalizePendingDelete(), 5000);
  }

  function finalizePendingDelete() {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    pendingDeleteId = null;
    pendingDeleteTimer = null;
    void fetch(`/api/books/${id}`, { method: 'DELETE' });
  }

  function getOrderedIds(): string[] {
    return [...booksHost.querySelectorAll<HTMLElement>('.m-book')]
      .map((el) => el.dataset.bookId!)
      .filter(Boolean);
  }

  function persistOrder() {
    const bookIds = getOrderedIds();
    void fetch('/api/books/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookIds }),
    });
  }

  function makeDraggable(row: HTMLElement, handle: HTMLElement) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startRect = row.getBoundingClientRect();
      const grabOffsetY = e.clientY - startRect.top;
      let moved = false;

      const spacer = document.createElement('div');
      spacer.className = 'm-book-spacer';
      spacer.style.height = startRect.height + 'px';
      booksHost.insertBefore(spacer, row);

      row.classList.add('dragging');
      row.style.width = startRect.width + 'px';
      row.style.left = startRect.left + 'px';
      row.style.top = startRect.top + 'px';

      handle.setPointerCapture(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientY - startRect.top - grabOffsetY) > 3) moved = true;
        row.style.top = (ev.clientY - grabOffsetY) + 'px';

        const dragCenter = ev.clientY - grabOffsetY + startRect.height / 2;
        const rows = [...booksHost.querySelectorAll<HTMLElement>('.m-book:not(.dragging)')];
        let placed = false;
        for (const other of rows) {
          const box = other.getBoundingClientRect();
          if (dragCenter < box.top + box.height / 2) {
            if (spacer.nextElementSibling !== other) booksHost.insertBefore(spacer, other);
            placed = true;
            break;
          }
        }
        if (!placed && booksHost.lastElementChild !== spacer) booksHost.appendChild(spacer);
      };

      const onUp = (ev: PointerEvent) => {
        handle.releasePointerCapture(ev.pointerId);
        booksHost.insertBefore(row, spacer);
        spacer.remove();
        row.classList.remove('dragging');
        row.style.width = '';
        row.style.left = '';
        row.style.top = '';
        if (moved) {
          row.dataset.dragged = '1';
          persistOrder();
        }
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }
}
