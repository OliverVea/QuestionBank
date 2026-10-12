import { html } from '@/lib/html';
import { authFetch } from '@/lib/auth';
import { renderLatex } from '@/lib/latex';
import { TopBar } from '@/components/TopBar';
import { Spinner } from '@/components/Spinner';
import { createFigureBoxEditor, type Box, type EditorPage } from '@/components/FigureBoxEditor';
import './FigureScanPage.css';
import './AddFiguresPage.css';

interface Problem { id: string; label: string; canonicalText: string }
interface FigureDto { id: string; url: string; printedLabel?: string }
interface FiguresResponse {
  pages: Array<{
    pageIndex: number;
    rectified: { pngBase64: string; width: number; height: number };
    figures: Array<{ box: Box }>;
  }>;
}

/** The server accepts at most this many page images per request. */
const PAGES_PER_REQUEST = 5;

/**
 * Add figures to problems that are already in a book. Photograph the page(s) the figures
 * are on, then for any problem pick a detected figure or draw a box; the crop is saved to
 * that problem at once. Existing figures can be removed here too.
 */
export function AddFiguresPage(): HTMLElement {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const bookId = params.get('bookId') || '';
  const backToBook = () => { window.location.hash = `#/edit-book?id=${encodeURIComponent(bookId)}`; };

  if (!bookId) {
    window.location.hash = '#/manage-books';
    return html`<div></div>`;
  }

  /** Page photos the learner added, flattened when the figure service is available. */
  const pages: EditorPage[] = [];
  /** A problem waiting for its box editor while its page photo is still loading. */
  let pendingProblem: Problem | null = null;

  const editor = createFigureBoxEditor(() => pages);

  // ---- page photos ----
  const picsEl = document.createElement('div');
  picsEl.className = 'fs-pics';
  const addPicLabel = html`<label class="fs-ghost-btn wide dashed af-add-photo">+ Add a photo of the page with the figure
    <input type="file" accept="image/*" hidden multiple />
  </label>` as HTMLLabelElement;
  const addPicInput = addPicLabel.querySelector('input') as HTMLInputElement;
  const status = html`<p class="af-status" hidden></p>` as HTMLElement;

  addPicInput.addEventListener('change', () => {
    const files = Array.from(addPicInput.files ?? []);
    addPicInput.value = '';
    if (files.length) void addPhotos(files);
  });

  function say(text: string | null) {
    status.hidden = text === null;
    status.textContent = text ?? '';
  }

  function renderPics() {
    picsEl.innerHTML = '';
    pages.forEach((p, i) => {
      const card = document.createElement('div');
      card.className = 'fs-pic';
      const im = document.createElement('img');
      im.alt = `page ${i + 1}`;
      im.src = p.img.src;
      const cap = document.createElement('span');
      cap.className = 'fs-pic-cap';
      cap.textContent = `Page ${i + 1}`;
      card.append(im, cap);
      picsEl.appendChild(card);
    });
  }

  async function addPhotos(files: File[]) {
    say(`Finding figures on ${files.length === 1 ? 'the page' : `${files.length} pages`}…`);
    addPicLabel.classList.add('busy');
    let flattened = true;
    for (let at = 0; at < files.length; at += PAGES_PER_REQUEST) {
      const batch = files.slice(at, at + PAGES_PER_REQUEST);
      const fromService = await flatten(batch);
      if (fromService) {
        pages.push(...fromService);
      } else {
        // No figure service (or it failed): the photo itself is still good enough to draw on.
        flattened = false;
        for (const file of batch) pages.push(await rawPage(file));
      }
    }
    addPicLabel.classList.remove('busy');
    say(flattened ? null : 'Figure detection is unavailable right now. Draw the box around the figure yourself.');
    renderPics();
    if (pendingProblem) {
      const problem = pendingProblem;
      pendingProblem = null;
      openEditor(problem, pages.length - files.length);
    }
  }

  /** Flatten a batch through the figure service; null when it is unavailable. */
  async function flatten(files: File[]): Promise<EditorPage[] | null> {
    try {
      const form = new FormData();
      for (const f of files) form.append('images', f);
      const res = await authFetch('/api/scan/figures', { method: 'POST', body: form });
      if (!res.ok) return null;
      const data = (await res.json()) as FiguresResponse;
      return await Promise.all(
        data.pages.map(async (p) => ({
          img: await decode(`data:image/png;base64,${p.rectified.pngBase64}`),
          width: p.rectified.width,
          height: p.rectified.height,
          guides: p.figures.map((f) => f.box),
        })),
      );
    } catch {
      return null;
    }
  }

  async function rawPage(file: File): Promise<EditorPage> {
    const img = await decode(URL.createObjectURL(file));
    return { img, width: img.naturalWidth, height: img.naturalHeight, guides: [] };
  }

  // ---- problems ----
  const list = document.createElement('div');
  list.appendChild(Spinner());

  function openEditor(problem: Problem, pageIndex?: number) {
    if (pages.length === 0) {
      // The figure has to come from a photo: ask for one, then come back to this problem.
      pendingProblem = problem;
      addPicInput.click();
      return;
    }
    editor.open({
      title: `Add figure · ${problem.label}`,
      ...(pageIndex !== undefined ? { pageIndex } : {}),
      onAttach: (page, box) => { void attach(problem, page, box); },
    });
  }

  async function attach(problem: Problem, pageIndex: number, box: Box) {
    const blob = await bakeCrop(pages[pageIndex]!.img, box);
    if (!blob) { say('That crop could not be made. Try drawing the box again.'); return; }
    const form = new FormData();
    form.append('crop', blob, 'figure.webp');
    const res = await authFetch(`/api/questions/${problem.id}/figures`, { method: 'POST', body: form });
    if (!res.ok) { say('The figure could not be saved. Try again.'); return; }
    say(`Figure added to ${problem.label}.`);
    await renderFigures(problem);
  }

  /** The strip of saved figures for one problem, each removable. */
  const strips = new Map<string, HTMLElement>();
  async function renderFigures(problem: Problem) {
    const strip = strips.get(problem.id);
    if (!strip) return;
    let figures: FigureDto[] = [];
    try {
      const res = await authFetch(`/api/questions/${problem.id}/figures`);
      if (res.ok) figures = (await res.json()) as FigureDto[];
    } catch { /* show none */ }
    strip.innerHTML = '';
    strip.closest('.fs-q')?.classList.toggle('has-fig', figures.length > 0);
    for (const fig of figures) {
      const imgRes = await authFetch(fig.url);
      if (!imgRes.ok) continue;
      const thumb = document.createElement('div');
      thumb.className = 'fs-thumb';
      const im = document.createElement('img');
      im.alt = fig.printedLabel ?? `figure for ${problem.label}`;
      im.src = URL.createObjectURL(await imgRes.blob());
      const x = document.createElement('button');
      x.className = 'fs-thumb-btn fs-thumb-x';
      x.type = 'button';
      x.title = 'Remove figure';
      x.textContent = '×';
      x.addEventListener('click', () => {
        void authFetch(`/api/questions/${problem.id}/figures/${fig.id}`, { method: 'DELETE' })
          .then(() => renderFigures(problem));
      });
      thumb.append(im, x);
      strip.appendChild(thumb);
    }
  }

  function makeCard(problem: Problem): HTMLElement {
    const card = document.createElement('div');
    card.className = 'fs-q';
    const head = document.createElement('div');
    head.className = 'fs-q-head';
    const label = document.createElement('span');
    label.className = 'fs-q-label';
    label.textContent = problem.label || '—';
    const add = document.createElement('button');
    add.className = 'fs-q-add fs-ghost-btn';
    add.type = 'button';
    add.textContent = '+ add figure';
    add.addEventListener('click', () => openEditor(problem));
    head.append(label, add);
    const body = document.createElement('div');
    body.className = 'fs-q-body af-q-body';
    renderLatex(body, problem.canonicalText);
    const strip = document.createElement('div');
    strip.className = 'fs-thumbs';
    strips.set(problem.id, strip);
    card.append(head, body, strip);
    return card;
  }

  async function load() {
    try {
      const res = await authFetch(`/api/books/${bookId}/questions`);
      if (!res.ok) throw new Error('load failed');
      const problems = (await res.json()) as Problem[];
      list.innerHTML = '';
      if (problems.length === 0) {
        list.appendChild(html`<p class="fs-lede">This book has no problems yet. Scan a problems page first.</p>`);
        return;
      }
      for (const problem of problems) {
        list.appendChild(makeCard(problem));
        void renderFigures(problem);
      }
    } catch {
      list.innerHTML = '';
      list.appendChild(html`<p class="fs-ex-error">The problems could not be loaded. Go back and try again.</p>`);
    }
  }

  const page = html`<div class="figure-scan-page add-figures-page">
    ${TopBar({ onBack: backToBook })}
    <main class="fs-main">
      <section class="fs-step active">
        <p class="fs-lede">Add a figure to a problem that is already in the book. Photograph the page the figure is on, then choose "add figure" on the problem it belongs to.</p>
        ${picsEl}
        ${addPicLabel}
        ${status}
        ${list}
      </section>
    </main>
    ${editor.root}
  </div>`;

  void load();
  return page;
}

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
}

/** Cut the box out of the page at full resolution, as the webp the figures API stores. */
function bakeCrop(img: HTMLImageElement, box: Box): Promise<Blob | null> {
  const [x1, y1, x2, y2] = box;
  const w = Math.max(1, Math.round(x2 - x1)), h = Math.max(1, Math.round(y2 - y1));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  try { c.getContext('2d')!.drawImage(img, x1, y1, w, h, 0, 0, w, h); } catch { return Promise.resolve(null); }
  return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/webp', 0.85));
}
