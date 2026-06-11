import { html } from '@/lib/html';
import { TopBar } from '@/components/TopBar';
import { CoverSlot } from '@/components/CoverSlot';
import { ProblemsList } from '@/components/ProblemsList';
import './AddBookPage.css';

export function AddBookPage(): HTMLElement {
  let dirty = false;

  // Form field references
  const isbnInput = document.createElement('input');
  isbnInput.className = 'field-in isbn-input';
  isbnInput.inputMode = 'numeric';
  isbnInput.placeholder = 'e.g. 9781107179868';

  const goBtn = document.createElement('button');
  goBtn.className = 'isbn-go';
  goBtn.type = 'button';
  goBtn.textContent = 'Look up';

  const statusEl = document.createElement('div');
  statusEl.className = 'lookup-status';
  statusEl.hidden = true;

  const fTitle = document.createElement('input');
  fTitle.className = 'field-in';
  fTitle.placeholder = 'Book title';
  fTitle.required = true;

  const fAuthor = document.createElement('input');
  fAuthor.className = 'field-in';
  fAuthor.placeholder = 'Author';

  const fMeta = document.createElement('div');
  fMeta.className = 'field-meta';
  fMeta.hidden = true;

  const fGoal = document.createElement('textarea');
  fGoal.className = 'field-in';
  fGoal.rows = 2;
  fGoal.placeholder = 'What do you want to get out of this book?';

  // Cover slot
  const coverEl = CoverSlot({ title: '' });

  // Problems list
  const problems = ProblemsList({ onChange: () => { dirty = true; syncCount(); } });

  // Save button
  const saveBtn = document.createElement('button');
  saveBtn.className = 'primary-btn';
  saveBtn.type = 'submit';
  saveBtn.disabled = true;

  const sbCount = document.createElement('span');
  sbCount.className = 'sb-count';
  saveBtn.textContent = 'Add to library ';
  saveBtn.appendChild(sbCount);

  function syncCount() {
    const n = problems.getProblems().length;
    sbCount.textContent = n ? `\u00b7 ${n} problem${n === 1 ? '' : 's'}` : '';
  }

  function syncSave() { saveBtn.disabled = fTitle.value.trim() === ''; }

  function refreshCover() {
    const newCover = CoverSlot({ title: fTitle.value.trim() });
    coverEl.replaceChildren(...Array.from(newCover.children));
  }

  function markDirty() { dirty = true; syncCount(); }

  // Assemble the page
  const page = html`<div class="add-book-page">
    <div></div>
    <form class="add-stage" autocomplete="off">
      <h1 class="add-title">Add a book</h1>
      <label class="field">
        <span class="field-lbl">ISBN <span class="field-opt">(optional \u2014 prefills the form)</span></span>
        <span class="isbn-row"></span>
      </label>
      <div></div>
      <div class="details-row">
        <div></div>
        <div class="details-fields">
          <label class="field">
            <span class="field-lbl">Title</span>
          </label>
          <label class="field">
            <span class="field-lbl">Author</span>
          </label>
          <div></div>
        </div>
      </div>
      <label class="field field-block">
        <span class="field-lbl">Learning goal <span class="field-opt">(optional)</span></span>
      </label>
      <div class="problems">
        <div class="problems-head"><h2>Problems</h2></div>
      </div>
    </form>
    <footer class="add-actions"></footer>
  </div>`;

  // Wire TopBar
  const topbarSlot = page.children[0] as HTMLElement;
  topbarSlot.replaceWith(TopBar({
    onBack: () => {
      if (dirty && !confirm('You have unsaved changes. Leave without saving?')) return;
      window.location.hash = '#/';
    },
  }));

  // Wire ISBN row
  const isbnRow = page.querySelector('.isbn-row')!;
  isbnRow.append(isbnInput, goBtn);

  // Wire status
  const isbnField = page.querySelector('.field')!;
  isbnField.after(statusEl);

  // Wire cover + fields
  const detailsRow = page.querySelector('.details-row')!;
  const coverPlaceholder = detailsRow.children[0] as HTMLElement;
  coverPlaceholder.replaceWith(coverEl);

  const detailsFields = page.querySelector('.details-fields')!;
  const titleLabel = detailsFields.children[0] as HTMLElement;
  titleLabel.appendChild(fTitle);
  const authorLabel = detailsFields.children[1] as HTMLElement;
  authorLabel.appendChild(fAuthor);
  const metaSlot = detailsFields.children[2] as HTMLElement;
  metaSlot.replaceWith(fMeta);

  // Wire goal
  const goalLabel = page.querySelector('.field-block')!;
  goalLabel.appendChild(fGoal);

  // Wire problems
  const problemsSection = page.querySelector('.problems')!;
  problemsSection.appendChild(problems.el);
  problemsSection.appendChild(problems.addButton);

  // Wire footer
  const footer = page.querySelector('.add-actions')!;
  footer.appendChild(saveBtn);

  // Event wiring
  fTitle.addEventListener('input', () => { syncSave(); refreshCover(); markDirty(); });
  fAuthor.addEventListener('input', markDirty);
  fGoal.addEventListener('input', markDirty);
  isbnInput.addEventListener('input', markDirty);

  // ISBN lookup
  async function lookup() {
    const isbn = isbnInput.value.replace(/[^0-9Xx]/g, '');
    if (!isbn) { isbnInput.focus(); return; }
    goBtn.disabled = true;
    statusEl.hidden = false;
    statusEl.className = 'lookup-status';
    statusEl.innerHTML = '<span class="spinner"></span> Looking up\u2026';

    try {
      const res = await fetch(`/api/lookup/isbn/${isbn}`);
      if (!res.ok) throw new Error('not found');
      const rec = await res.json();
      fTitle.value = rec.title || fTitle.value;
      fAuthor.value = rec.author || fAuthor.value;
      const meta = [rec.publisher, rec.year].filter(Boolean).join(' \u00b7 ');
      fMeta.textContent = meta;
      fMeta.hidden = !meta;
      statusEl.hidden = true;
    } catch {
      statusEl.className = 'lookup-status warn';
      statusEl.textContent = 'No match for that ISBN \u2014 fill in the details yourself.';
      fMeta.hidden = true;
    }
    refreshCover();
    syncSave();
    markDirty();
    goBtn.disabled = false;
  }

  goBtn.addEventListener('click', lookup);
  isbnInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); void lookup(); }
  });

  // Form submit
  const form = page.querySelector('form')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!fTitle.value.trim()) return;
    saveBtn.disabled = true;

    const body = {
      title: fTitle.value.trim(),
      author: fAuthor.value.trim() || undefined,
      learningGoal: fGoal.value.trim() || undefined,
      isbn: isbnInput.value.trim() || undefined,
    };

    try {
      const res = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('save failed');
      const book = await res.json();

      // Create questions
      const probs = problems.getProblems().filter(p => p.latex);
      for (const prob of probs) {
        await fetch('/api/questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookId: book.id, label: prob.label, text: prob.latex }),
        });
      }

      dirty = false;
      window.location.hash = '#/';
    } catch {
      saveBtn.disabled = false;
    }
  });

  // Dirty guard
  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  syncCount();
  syncSave();

  // Handle ?isbn=X deep link
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const preIsbn = params.get('isbn');
  if (preIsbn) { isbnInput.value = preIsbn; void lookup().then(() => { dirty = false; }); }

  return page;
}
