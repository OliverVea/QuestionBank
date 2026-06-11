import { html } from '@/lib/html';
import { TopBar } from '@/components/TopBar';
import { CoverSlot } from '@/components/CoverSlot';
import { ProblemsList } from '@/components/ProblemsList';
import './AddBookPage.css';

export function AddBookPage(): HTMLElement {
  let dirty = false;
  let coverSlot = CoverSlot({});

  const titleInput = document.createElement('input');
  titleInput.className = 'field-in';
  titleInput.id = 'f-title';
  titleInput.placeholder = 'Book title';
  titleInput.required = true;

  const authorInput = document.createElement('input');
  authorInput.className = 'field-in';
  authorInput.id = 'f-author';
  authorInput.placeholder = 'Author';

  const goalInput = document.createElement('textarea');
  goalInput.className = 'field-in';
  goalInput.id = 'f-goal';
  goalInput.rows = 2;
  goalInput.placeholder = 'What do you want to get out of this book?';

  const isbnInput = document.createElement('input');
  isbnInput.className = 'field-in isbn-input';
  isbnInput.inputMode = 'numeric';
  isbnInput.placeholder = 'e.g. 9781107179868';

  const lookupStatus = html`<div class="lookup-status" hidden></div>`;
  const saveBtn = html`<button class="primary-btn" type="button" disabled>Add to library</button>`;

  const problemsList = ProblemsList({ onChange: markDirty });

  function markDirty() {
    dirty = true;
    updateSaveState();
  }

  function updateSaveState() {
    const hasTitle = titleInput.value.trim() !== '';
    (saveBtn as HTMLButtonElement).disabled = !hasTitle;
  }

  // ISBN lookup.
  async function doLookup() {
    const isbn = isbnInput.value.trim();
    if (!isbn) return;
    lookupStatus.hidden = false;
    lookupStatus.innerHTML = '<span class="spinner"></span> Looking up…';

    try {
      const res = await fetch(`/api/lookup/isbn/${encodeURIComponent(isbn)}`);
      if (!res.ok) {
        lookupStatus.classList.add('warn');
        lookupStatus.textContent = res.status === 404 ? 'Not found — enter details manually.' : 'Lookup failed.';
        return;
      }
      const data = await res.json();
      if (data.title) { titleInput.value = data.title; markDirty(); }
      if (data.author) { authorInput.value = data.author; markDirty(); }
      // Replace cover with one that has the ISBN.
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

  // Save action.
  saveBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) return;
    (saveBtn as HTMLButtonElement).disabled = true;
    saveBtn.textContent = 'Saving…';

    const problems = problemsList.getProblems();
    try {
      const bookRes = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          author: authorInput.value.trim() || undefined,
          learningGoal: goalInput.value.trim() || undefined,
          isbn: isbnInput.value.trim() || undefined,
        }),
      });
      if (!bookRes.ok) throw new Error('Failed to create book');
      const book = await bookRes.json();

      // Create problems and add to book.
      for (const p of problems) {
        if (!p.latex.trim()) continue;
        await fetch('/api/questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookId: book.id, label: p.label, text: p.latex }),
        });
      }

      dirty = false;
      window.location.hash = '#/';
    } catch {
      saveBtn.textContent = 'Add to library';
      (saveBtn as HTMLButtonElement).disabled = false;
    }
  });

  // Unsaved changes guard.
  const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
  window.addEventListener('beforeunload', beforeUnload);

  const page = html`<div class="add-book-page">
    ${TopBar({ onBack: () => { window.location.hash = '#/'; } })}
    <form class="add-stage" autocomplete="off">
      <h1 class="add-title">Add a book</h1>

      <label class="field">
        <span class="field-lbl">ISBN <span class="field-opt">(optional — prefills the form)</span></span>
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

  return page;
}
