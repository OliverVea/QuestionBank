import { html } from '@/lib/html';
import { authFetch } from '@/lib/auth';
import { TopBar } from '@/components/TopBar';
import { CoverSlot } from '@/components/CoverSlot';
import { ProblemsList } from '@/components/ProblemsList';
import { Spinner } from '@/components/Spinner';
import type { Relevance } from '@/lib/types';
import './EditBookPage.css';

interface Book {
  id: string;
  title: string;
  author?: string;
  learningGoal?: string;
  isbn?: string;
  publisher?: string;
  year?: number;
}

interface Question {
  id: string;
  label: string;
  canonicalText: string;
  relevance?: string;
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

  const publisherInput = document.createElement('input');
  publisherInput.className = 'field-in';
  publisherInput.placeholder = 'Publisher';

  const yearInput = document.createElement('input');
  yearInput.className = 'field-in';
  yearInput.inputMode = 'numeric';
  yearInput.placeholder = 'Year';

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

  const problemsList = ProblemsList({ onChange: markDirty, getLearningGoal: () => goalInput.value.trim(), bookId });

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
      const res = await authFetch(`/api/lookup/isbn/${encodeURIComponent(isbn)}`);
      if (!res.ok) {
        lookupStatus.classList.add('warn');
        lookupStatus.textContent = res.status === 404 ? 'Not found — edit details manually.' : 'Lookup failed.';
        return;
      }
      const data = await res.json();
      if (data.title) { titleInput.value = data.title; markDirty(); }
      if (data.author) { authorInput.value = data.author; markDirty(); }
      if (data.publisher) { publisherInput.value = data.publisher; markDirty(); }
      if (data.year) { yearInput.value = String(data.year); markDirty(); }
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
  publisherInput.addEventListener('input', markDirty);
  yearInput.addEventListener('input', markDirty);
  goalInput.addEventListener('input', markDirty);

  /**
   * PUT the current problem list for this book and return the server's saved rows
   * (ordered, each with its id). Shared by manual Save and scan auto-save.
   */
  async function putProblems(): Promise<Question[]> {
    const problems = problemsList.getProblems();
    const res = await authFetch(`/api/books/${bookId}/questions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questions: problems.map((p) => ({
          ...(p.id ? { id: p.id } : {}),
          label: p.label,
          canonicalText: p.latex,
          relevance: p.relevance,
        })),
      }),
    });
    return res.json();
  }

  // Save: PATCH book metadata + PUT problems list.
  saveBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) return;
    (saveBtn as HTMLButtonElement).disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      const yearNum = Number.parseInt(yearInput.value.trim(), 10);
      await authFetch(`/api/books/${bookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          author: authorInput.value.trim(),
          learningGoal: goalInput.value.trim(),
          isbn: isbnInput.value.trim(),
          publisher: publisherInput.value.trim(),
          ...(Number.isNaN(yearNum) ? {} : { year: yearNum }),
        }),
      });

      await putProblems();

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

  const spinner = Spinner();
  const form = html`<form class="add-stage" autocomplete="off" hidden>
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

      ${problemsList.el}
    </form>`;

  const footerEl = html`<footer class="add-actions" hidden>${saveBtn}</footer>`;

  const page = html`<div class="edit-book-page">
    ${TopBar({ onBack: () => { window.location.hash = '#/manage-books'; } })}
    ${spinner}
    ${form}
    ${footerEl}
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
    if (!bookId) { showForm(); return; }
    try {
      const [book, questions]: [Book, Question[]] = await Promise.all([
        authFetch(`/api/books/${bookId}`).then((r) => r.json()),
        authFetch(`/api/books/${bookId}/questions`).then((r) => r.json()),
      ]);

      titleInput.value = book.title;
      authorInput.value = book.author ?? '';
      publisherInput.value = book.publisher ?? '';
      yearInput.value = book.year !== undefined ? String(book.year) : '';
      goalInput.value = book.learningGoal ?? '';
      isbnInput.value = book.isbn ?? '';

      // Replace cover with one using real data.
      const newCover = CoverSlot({ title: book.title, isbn: book.isbn });
      coverSlot.replaceWith(newCover);
      coverSlot = newCover;

      // Populate problems list.
      const validRelevance = new Set<string>(['high', 'medium', 'low']);
      for (const q of questions) {
        const rel = validRelevance.has(q.relevance ?? '') ? q.relevance as Relevance : undefined;
        problemsList.addRow({ id: q.id, label: q.label, latex: q.canonicalText, ...(rel ? { relevance: rel } : {}) });
      }

      updateSaveState();
      dirty = false; // Prefill is not a user change.

      // Apply problems handed back from a scan AFTER existing rows have loaded (so an
      // `edit` delta can match its target row), then persist immediately: scanned
      // problems are committed on return, not left as an unsaved draft. This also makes
      // them visible to the next scan's dedupe (which loads the book's saved problems).
      await applyReturnedScanProblems();
    } catch {
      // If load fails, leave the form empty — user can fill manually.
    }
    showForm();
  }

  /** Merge scan-accepted problems into the loaded list and auto-save them. */
  async function applyReturnedScanProblems() {
    const applied = problemsList.applyReturnedProblems();
    if (!applied) return;
    try {
      // Persist, then resync the in-memory rows to the server's saved list so the new
      // problems carry their assigned ids (otherwise a later manual Save would re-create
      // them as duplicates and delete the originals). Re-fetch the GET (not the PUT
      // response) so the rows land in DERIVED path order — the PUT echoes questionIds
      // (insertion) order, which would show a scanned problem out of place.
      await putProblems();
      const saved: Question[] = await authFetch(`/api/books/${bookId}/questions`).then((r) => r.json());
      const validRelevance = new Set<string>(['high', 'medium', 'low']);
      problemsList.setProblems(
        saved.map((q) => {
          const rel = validRelevance.has(q.relevance ?? '') ? (q.relevance as Relevance) : undefined;
          return { id: q.id, label: q.label, latex: q.canonicalText, ...(rel ? { relevance: rel } : {}) };
        }),
      );
      dirty = false; // The scanned problems are now persisted.
    } catch {
      // Auto-save failed — keep them in the list and mark dirty so a manual Save retries.
      markDirty();
    }
  }

  function showForm() {
    spinner.remove();
    form.hidden = false;
    footerEl.hidden = false;
  }
}
