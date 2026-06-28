import { html } from '@/lib/html';
import { authFetch } from '@/lib/auth';
import { TopBar } from '@/components/TopBar';
import { CoverSlot } from '@/components/CoverSlot';
import '@/styles/forms.css';
import './AddBookPage.css';

export function AddBookPage(): HTMLElement {
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

  const publisherInput = document.createElement('input');
  publisherInput.className = 'field-in';
  publisherInput.id = 'f-publisher';
  publisherInput.placeholder = 'Publisher';

  const yearInput = document.createElement('input');
  yearInput.className = 'field-in';
  yearInput.id = 'f-year';
  yearInput.inputMode = 'numeric';
  yearInput.placeholder = 'Year';

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

  function updateSaveState() {
    (saveBtn as HTMLButtonElement).disabled = titleInput.value.trim() === '';
  }

  // ISBN lookup.
  async function doLookup() {
    const isbn = isbnInput.value.trim();
    if (!isbn) return;
    lookupStatus.hidden = false;
    lookupStatus.innerHTML = '<span class="spinner"></span> Looking up…';

    try {
      const res = await authFetch(`/api/lookup/isbn/${encodeURIComponent(isbn)}`);
      if (!res.ok) {
        lookupStatus.classList.add('warn');
        lookupStatus.textContent = res.status === 404 ? 'Not found — enter details manually.' : 'Lookup failed.';
        return;
      }
      const data = await res.json();
      if (data.title) { titleInput.value = data.title; updateSaveState(); }
      if (data.author) { authorInput.value = data.author; }
      if (data.publisher) { publisherInput.value = data.publisher; }
      if (data.year) { yearInput.value = String(data.year); }
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
  titleInput.addEventListener('input', updateSaveState);

  // Save: create book, then redirect to edit-book page.
  saveBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) return;
    (saveBtn as HTMLButtonElement).disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      const yearNum = Number.parseInt(yearInput.value.trim(), 10);
      const res = await authFetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          author: authorInput.value.trim() || undefined,
          learningGoal: goalInput.value.trim() || undefined,
          isbn: isbnInput.value.trim() || undefined,
          publisher: publisherInput.value.trim() || undefined,
          year: Number.isNaN(yearNum) ? undefined : yearNum,
        }),
      });
      if (!res.ok) throw new Error('Failed to create book');
      const book = await res.json();
      window.location.hash = `#/edit-book?id=${book.id}`;
    } catch {
      saveBtn.textContent = 'Add to library';
      (saveBtn as HTMLButtonElement).disabled = false;
    }
  });

  return html`<div class="add-book-page">
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
          <label class="field">
            <span class="field-lbl">Publisher</span>
            ${publisherInput}
          </label>
          <label class="field">
            <span class="field-lbl">Year</span>
            ${yearInput}
          </label>
        </div>
      </div>

      <label class="field field-block">
        <span class="field-lbl">Learning goal <span class="field-opt">(optional)</span></span>
        ${goalInput}
      </label>
    </form>

    <footer class="add-actions">
      ${saveBtn}
    </footer>
  </div>`;
}
