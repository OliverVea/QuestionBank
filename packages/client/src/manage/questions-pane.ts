import { api } from '../api/client.js';
import type { ChapterTree, Question } from '../api/types.js';
import { createImageInput } from '../components/image-input.js';
import { renderContent } from '../render/content.js';

/**
 * Render a chapter's questions: KaTeX-rendered read view with an edit toggle, plus inline add.
 * @param host element to render into
 * @param chapter the chapter being viewed (carries its initial questions)
 * @param bookTitle for the breadcrumb
 * @param onBack return to the chapters list
 */
export async function renderQuestionsPane(
  host: HTMLElement,
  chapter: ChapterTree,
  bookTitle: string,
  onBack: () => void,
): Promise<void> {
  host.innerHTML = '';

  const crumb = document.createElement('div');
  crumb.className = 'crumb';
  const back = document.createElement('button');
  back.textContent = `← ${bookTitle}`;
  back.addEventListener('click', onBack);
  crumb.appendChild(back);

  const title = document.createElement('h2');
  title.textContent = chapter.title;

  const list = document.createElement('div');
  list.className = 'list';
  list.textContent = 'loading…';

  host.append(crumb, title, list);

  async function refresh(): Promise<void> {
    // Re-fetch via the tree so we always show server truth.
    const tree = await api.getBookTree(chapter.bookId);
    const fresh = tree.chapters.find((c) => c.id === chapter.id);
    const questions = fresh?.questions ?? [];
    list.innerHTML = '';
    for (const q of questions) list.appendChild(renderQuestionRow(q, refresh));
  }

  const addRow = document.createElement('div');
  addRow.className = 'add-row';
  const input = document.createElement('input');
  input.placeholder = 'New question LaTeX…';
  const labelInput = document.createElement('input');
  labelInput.placeholder = 'label (e.g. 2.4)';
  labelInput.style.maxWidth = '8rem';
  const addBtn = document.createElement('button');
  addBtn.textContent = 'Add';

  async function add(): Promise<void> {
    const canonicalText = input.value.trim();
    if (!canonicalText) return;
    const label = labelInput.value.trim();
    await api.createQuestion(chapter.id, label ? { canonicalText, label } : { canonicalText });
    input.value = '';
    labelInput.value = '';
    await refresh();
    input.focus();
  }

  addBtn.addEventListener('click', add);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void add();
  });

  // Extract-from-image via the reusable image-input control (Take photo / Choose
  // image). Single-file here; the same component runs in multi-file mode for answer
  // photos in the Learn tab.
  const status = document.createElement('div');
  status.className = 'status';

  const imageInput = createImageInput({
    onFiles: (files) => {
      const file = files[0];
      if (file) void runExtract(file);
    },
  });

  // Shared upload flow: disable the controls, show progress, extract, refresh.
  async function runExtract(file: File): Promise<void> {
    addBtn.disabled = true;
    imageInput.setDisabled(true);
    status.textContent = 'Extracting…';
    try {
      await api.extractQuestionsFromImage(chapter.id, file);
      await refresh();
      status.textContent = '';
    } catch {
      status.textContent = 'Extraction failed — try again.';
    } finally {
      addBtn.disabled = false;
      imageInput.setDisabled(false);
      imageInput.reset();
    }
  }

  addRow.append(labelInput, input, addBtn, imageInput.element);
  host.append(addRow, status);

  await refresh();
}

/** One question row: read mode (KaTeX-rendered .qbody card) ⇄ edit mode (raw-source textarea). */
function renderQuestionRow(q: Question, refresh: () => Promise<void>): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row';

  function readMode(): void {
    row.innerHTML = '';
    const body = document.createElement('div');
    body.className = 'grow';

    if (q.label) {
      const lbl = document.createElement('strong');
      lbl.textContent = `${q.label} `;
      body.appendChild(lbl);
    }
    const content = document.createElement('div');
    content.className = 'qbody';
    renderContent(content, q.canonicalText);
    body.appendChild(content);

    const edit = document.createElement('button');
    edit.className = 'link';
    edit.textContent = 'edit';
    edit.addEventListener('click', editMode);

    const del = document.createElement('button');
    del.className = 'link';
    del.textContent = 'delete';
    del.addEventListener('click', async () => {
      await api.deleteQuestion(q.id);
      await refresh();
    });

    row.append(body, edit, del);
  }

  function editMode(): void {
    row.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'grow';

    const labelInput = document.createElement('input');
    labelInput.placeholder = 'label';
    labelInput.value = q.label ?? '';
    labelInput.style.maxWidth = '8rem';

    const textarea = document.createElement('textarea');
    textarea.value = q.canonicalText;
    textarea.rows = 3;
    textarea.style.width = '100%';

    const save = document.createElement('button');
    save.className = 'link';
    save.textContent = 'save';
    save.addEventListener('click', async () => {
      const canonicalText = textarea.value.trim();
      if (!canonicalText) return;
      const label = labelInput.value.trim();
      await api.updateQuestion(q.id, { canonicalText, label });
      await refresh();
    });

    const cancel = document.createElement('button');
    cancel.className = 'link';
    cancel.textContent = 'cancel';
    cancel.addEventListener('click', readMode);

    wrap.append(labelInput, textarea);
    row.append(wrap, save, cancel);
    textarea.focus();
  }

  readMode();
  return row;
}
