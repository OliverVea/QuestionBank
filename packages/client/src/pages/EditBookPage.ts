import { html } from '@/lib/html';
import { TopBar } from '@/components/TopBar';
import { CoverSlot } from '@/components/CoverSlot';
import { ProblemsList } from '@/components/ProblemsList';
import './EditBookPage.css';

interface Book {
  id: string;
  title: string;
  author?: string;
  learningGoal?: string;
  isbn?: string;
}

interface Question {
  id: string;
  label: string;
  canonicalText: string;
}

export function EditBookPage(): HTMLElement {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const bookId = params.get('id') || '';

  let dirty = false;
  let coverSlot = CoverSlot({});

  const titleInput = document.createElement('input');
  titleInput.className = 'field-in';
  titleInput.placeholder = 'Book title';
  titleInput.required = true;

  const authorInput = document.createElement('input');
  authorInput.className = 'field-in';
  authorInput.placeholder = 'Author';

  const goalInput = document.createElement('textarea');
  goalInput.className = 'field-in';
  goalInput.rows = 2;
  goalInput.placeholder = 'What do you want to get out of this book?';

  const isbnInput = document.createElement('input');
  isbnInput.className = 'field-in isbn-input';
  isbnInput.inputMode = 'numeric';
  isbnInput.placeholder = 'e.g. 9781107179868';

  const lookupStatus = html`<div class="lookup-status" hidden></div>`;
  const saveBtn = html`<button class="primary-btn" type="button" disabled>Save changes</button>`;

  const problemsList = ProblemsList({ onChange: markDirty });

  function markDirty() {
    dirty = true;
    updateSaveState();
  }

  function updateSaveState() {
    (saveBtn as HTMLButtonElement).disabled = titleInput.value.trim() === '';
  }

  // ISBN re-lookup.
  async function doLookup() {
    const isbn = isbnInput.value.trim();
    if (!isbn) return;
    lookupStatus.hidden = false;
    lookupStatus.innerHTML = '<span class="spinner"></span> Looking up…';

    try {
      const res = await fetch(`/api/lookup/isbn/${encodeURIComponent(isbn)}`);
      if (!res.ok) {
        lookupStatus.classList.add('warn');
        lookupStatus.textContent = res.status === 404 ? 'Not found — edit details manually.' : 'Lookup failed.';
        return;
      }
      const data = await res.json();
      if (data.title) { titleInput.value = data.title; markDirty(); }
      if (data.author) { authorInput.value = data.author; markDirty(); }
      const newCover = CoverSlot({ title: data.title, isbn });
      coverSlot.replaceWith(newCover);
      coverSlot = newCover;
      lookupStatus.hidden = true;
      lookupStatus.classList.remove('warn');
    } catch {
      lookupStatus.classList.add('warn');
      lookupStatus.textContent = 'Network error.';
    }
  }

  const lookupBtn = html`<button class="isbn-go" type="button">Look up</button>`;
  lookupBtn.addEventListener('click', doLookup);
  isbnInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLookup(); });
  titleInput.addEventListener('input', () => { markDirty(); updateSaveState(); });
  authorInput.addEventListener('input', markDirty);
  goalInput.addEventListener('input', markDirty);

  // Save: PATCH book metadata + PUT problems list.
  saveBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) return;
    (saveBtn as HTMLButtonElement).disabled = true;
    saveBtn.textContent = 'Saving…';

    const problems = problemsList.getProblems();
    try {
      await fetch(`/api/books/${bookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          author: authorInput.value.trim(),
          learningGoal: goalInput.value.trim(),
          isbn: isbnInput.value.trim(),
        }),
      });

      await fetch(`/api/books/${bookId}/questions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questions: problems.map((p) => ({
            ...(p.id ? { id: p.id } : {}),
            label: p.label,
            canonicalText: p.latex,
          })),
        }),
      });

      dirty = false;
      window.location.hash = '#/manage-books';
    } catch {
      saveBtn.textContent = 'Save changes';
      (saveBtn as HTMLButtonElement).disabled = false;
    }
  });

  // Unsaved changes guard.
  const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
  window.addEventListener('beforeunload', beforeUnload);

  const page = html`<div class="edit-book-page">
    ${TopBar({ onBack: () => { window.location.hash = '#/manage-books'; } })}
    <form class="add-stage" autocomplete="off">
      <h1 class="add-title">Edit book</h1>

      <label class="field">
        <span class="field-lbl">ISBN <span class="field-opt">(re-look up to refresh details)</span></span>
        <span class="isbn-row">
          ${isbnInput}
          ${lookupBtn}
        </span>
      </label>

      ${lookupStatus}

      <div class="details-row">
        ${coverSlot}
        <div class="details-fields">
          <label class="field">
            <span class="field-lbl">Title</span>
            ${titleInput}
          </label>
          <label class="field">
            <span class="field-lbl">Author</span>
            ${authorInput}
          </label>
        </div>
      </div>

      <label class="field field-block">
        <span class="field-lbl">Learning goal <span class="field-opt">(optional)</span></span>
        ${goalInput}
      </label>

      ${problemsList.el}
    </form>

    <footer class="add-actions">
      ${saveBtn}
    </footer>
  </div>`;

  // Clean up beforeunload when the page is unmounted.
  const observer = new MutationObserver(() => {
    if (!document.contains(page)) {
      window.removeEventListener('beforeunload', beforeUnload);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Load the book data and pre-fill.
  void loadBook();
  return page;

  async function loadBook() {
    if (!bookId) return;
    try {
      const [book, questions]: [Book, Question[]] = await Promise.all([
        fetch(`/api/books/${bookId}`).then((r) => r.json()),
        fetch(`/api/books/${bookId}/questions`).then((r) => r.json()),
      ]);

      titleInput.value = book.title;
      authorInput.value = book.author ?? '';
      goalInput.value = book.learningGoal ?? '';
      isbnInput.value = book.isbn ?? '';

      // Replace cover with one using real data.
      const newCover = CoverSlot({ title: book.title, isbn: book.isbn });
      coverSlot.replaceWith(newCover);
      coverSlot = newCover;

      // Populate problems list.
      for (const q of questions) {
        problemsList.addRow({ id: q.id, label: q.label, latex: q.canonicalText });
      }

      updateSaveState();
      dirty = false; // Prefill is not a user change.
    } catch {
      // If load fails, leave the form empty — user can fill manually.
    }
  }
}
