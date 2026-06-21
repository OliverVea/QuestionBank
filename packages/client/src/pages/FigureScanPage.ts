import { html } from '@/lib/html';
import { renderLatex } from '@/lib/latex';
import { TopBar } from '@/components/TopBar';
import { unstashPhotos } from '@/lib/photo-transfer';
import './FigureScanPage.css';

type Relevance = 'high' | 'medium' | 'low';
type Box = [number, number, number, number];

interface Delta {
  kind: 'add' | 'edit' | 'skip';
  path?: string;
  canonicalText: string;
  targetId?: string;
  relevance?: Relevance;
  figureRefs?: string[];
}
interface NeedsSection {
  pageIndex: number;
  problems: Array<{ localLabel: string; canonicalText: string }>;
}
interface Envelope {
  resolved: Delta[];
  needsSection: NeedsSection[];
}
interface ScanFigure {
  detectionId: number;
  box: Box;
  score: number;
  matchedAddIndex?: number | null;
  printedLabel?: string;
  confidence?: Relevance;
}
interface ScanPage {
  pageIndex: number;
  rectified: { pngBase64: string; width: number; height: number };
  figures: ScanFigure[];
}
interface ScanResponse {
  envelope: Envelope;
  pages: ScanPage[];
  figuresError?: boolean;
  matchError?: boolean;
}

/** An attached figure: a box in rectified pixel coords, owned by a resolved `add`. */
interface WizFigure {
  uid: number;
  addIndex: number; // index into `resolved`
  pageIndex: number;
  box: Box;
  printedLabel?: string;
  confidence?: Relevance;
}

const norm = (b: Box): Box => [
  Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3]),
];

export function FigureScanPage(): HTMLElement {
  const transfer = unstashPhotos();
  const files = transfer?.files ?? [];
  const bookId = transfer?.bookId ?? '';

  // Guard: redirect if no photo context.
  if (files.length === 0 || !bookId) {
    window.location.hash = '#/manage-books';
    return html`<div></div>`;
  }

  // ---- wizard state (seeded from /api/scan) ----
  let step = 1;
  let resolved: Delta[] = [];
  let needsSection: NeedsSection[] = [];
  let accepted: boolean[] = []; // by resolved index (add/edit); skip ignored
  const sectionAnswers: Record<string, string> = {};
  let pendingPrompts = 0;
  const pageImgs: HTMLImageElement[] = []; // decoded rectified pages, by pageIndex
  const pageDims: Array<{ width: number; height: number }> = [];
  const detectedByPage = new Map<number, Box[]>();
  let figures: WizFigure[] = [];
  let nextUid = 1;
  let figuresError = false;

  const attachedFor = (addIndex: number) => figures.filter((f) => f.addIndex === addIndex);

  // ---- DOM skeleton ----
  const stepsNav = document.createElement('nav');
  stepsNav.className = 'fs-steps';
  ([['1', 'Pictures'], ['2', 'Extract'], ['3', 'Questions']] as const).forEach(([n, label]) => {
    const pill = document.createElement('button');
    pill.className = 'fs-step-pill';
    pill.dataset.go = n;
    pill.innerHTML = `<b>${n}</b> ${label}`;
    pill.addEventListener('click', () => { if (+n !== 2) showStep(+n); });
    stepsNav.appendChild(pill);
  });

  const picsEl = document.createElement('div');
  picsEl.className = 'fs-pics';
  const addPicLabel = html`<label class="fs-ghost-btn wide dashed" style="display:block;text-align:center;cursor:pointer;">+ Add another page
    <input type="file" accept="image/*" hidden multiple />
  </label>` as HTMLLabelElement;
  const addPicInput = addPicLabel.querySelector('input') as HTMLInputElement;
  addPicInput.addEventListener('change', () => {
    for (const f of Array.from(addPicInput.files ?? [])) files.push(f);
    addPicInput.value = '';
    renderPics();
  });
  const step1 = html`<section class="fs-step" data-step="1">
    <p class="fs-lede">Confirm the page(s) you photographed. Add more, or remove any that didn't come out.</p>
    ${picsEl}
    ${addPicLabel}
  </section>`;

  const step2 = html`<section class="fs-step" data-step="2">
    <div class="fs-extracting">
      <span class="fs-dots"><span></span><span></span><span></span></span>
      <div class="fs-ex-lines">
        <div class="fs-ex-line" data-ex="0">Dewarping the page(s)…</div>
        <div class="fs-ex-line" data-ex="1">Reading problems…</div>
        <div class="fs-ex-line" data-ex="2">Detecting figures…</div>
        <div class="fs-ex-line" data-ex="3">Matching figures to problems…</div>
      </div>
    </div>
  </section>`;

  const needsEl = document.createElement('div');
  const qList = document.createElement('div');
  const step3 = html`<section class="fs-step" data-step="3">
    <p class="fs-lede">Problems read off the page, with their figures. Tap the text to edit it; add, edit, or remove a figure on any problem.</p>
    ${needsEl}
    ${qList}
  </section>`;

  const main = html`<main class="fs-main">${step1}${step2}${step3}</main>`;

  const navBack = html`<button class="fs-back-btn" type="button">Back</button>` as HTMLButtonElement;
  const navNext = html`<button class="primary-btn" type="button">Extract figures</button>` as HTMLButtonElement;
  navBack.addEventListener('click', () => {
    if (step === 1) { window.history.back(); return; }
    showStep(1);
  });
  navNext.addEventListener('click', () => {
    if (step === 1) { showStep(2); return; }
    if (step === 3) { void commit(); return; }
  });
  const footer = html`<footer class="fs-actions">
    ${navBack}
    <span class="fs-spacer"></span>
    ${navNext}
  </footer>`;

  // ---- subpage (figure selection) ----
  const subEls = buildSubpage();

  const page = html`<div class="figure-scan-page">
    ${TopBar({ onBack: () => window.history.back() })}
    ${stepsNav}
    ${main}
    ${footer}
    ${subEls.root}
  </div>`;

  // ============================ steps ============================
  function showStep(n: number) {
    step = n;
    main.querySelectorAll('.fs-step').forEach((s) => {
      s.classList.toggle('active', Number((s as HTMLElement).dataset.step) === n);
    });
    stepsNav.querySelectorAll('.fs-step-pill').forEach((p) => {
      p.classList.toggle('on', Number((p as HTMLElement).dataset.go) === n);
    });
    navBack.style.visibility = n > 1 ? 'visible' : 'hidden';
    navNext.textContent = n === 1 ? 'Extract figures' : 'Continue';
    navNext.style.visibility = n === 2 ? 'hidden' : 'visible';
    if (n === 1) { extractionStarted = false; renderPics(); }
    if (n === 2) void runExtraction();
    if (n === 3) { renderQuestions(); renderNeedsSection(); syncContinue(); }
  }

  // ---- step 1: pictures ----
  function renderPics() {
    picsEl.innerHTML = '';
    files.forEach((file, i) => {
      const card = document.createElement('div');
      card.className = 'fs-pic';
      const im = document.createElement('img');
      im.alt = `page ${i + 1}`;
      const url = URL.createObjectURL(file);
      im.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
      im.src = url;
      const cap = document.createElement('span');
      cap.className = 'fs-pic-cap';
      cap.textContent = `Page ${i + 1}`;
      card.append(im, cap);
      if (files.length > 1) {
        const x = document.createElement('button');
        x.className = 'fs-thumb-btn fs-thumb-x';
        x.type = 'button';
        x.textContent = '×';
        x.title = 'Remove page';
        x.addEventListener('click', () => { files.splice(i, 1); renderPics(); });
        card.appendChild(x);
      }
      picsEl.appendChild(card);
    });
  }

  // ---- step 2: extract via /api/scan ----
  let extractionStarted = false;
  async function runExtraction() {
    if (extractionStarted) return;
    extractionStarted = true;
    const lines = Array.from(step2.querySelectorAll('.fs-ex-line')) as HTMLElement[];
    lines.forEach((l) => l.classList.remove('done'));
    let i = 0;
    const timer = setInterval(() => {
      if (i < lines.length - 1) lines[i++]!.classList.add('done');
    }, 500);

    try {
      const form = new FormData();
      form.append('bookId', bookId);
      for (const f of files) form.append('images', f);
      const res = await fetch('/api/scan', { method: 'POST', body: form });
      if (!res.ok) throw new Error(`http-${res.status}`);
      const data = (await res.json()) as ScanResponse;
      await seedFromScan(data);
      clearInterval(timer);
      lines.forEach((l) => l.classList.add('done'));
      showStep(3);
    } catch {
      clearInterval(timer);
      extractionStarted = false;
      const box = step2.querySelector('.fs-extracting') as HTMLElement;
      box.innerHTML = '';
      const err = document.createElement('div');
      err.className = 'fs-ex-error';
      err.textContent = 'Extraction failed. Go back and try again.';
      const back = document.createElement('button');
      back.className = 'fs-ghost-btn';
      back.type = 'button';
      back.textContent = 'Back to pictures';
      back.addEventListener('click', () => showStep(1));
      box.append(err, back);
    }
  }

  async function seedFromScan(data: ScanResponse) {
    resolved = data.envelope.resolved ?? [];
    needsSection = data.envelope.needsSection ?? [];
    accepted = resolved.map((d) => d.kind !== 'skip');
    figuresError = data.figuresError ?? false;
    figures = [];
    detectedByPage.clear();
    pageImgs.length = 0;
    pageDims.length = 0;

    for (const p of data.pages ?? []) {
      // Decode the rectified page (decode-gate every cut() that follows).
      pageImgs[p.pageIndex] = await decodeImg(p.rectified.pngBase64);
      pageDims[p.pageIndex] = { width: p.rectified.width, height: p.rectified.height };
      detectedByPage.set(p.pageIndex, p.figures.map((f) => f.box));
      for (const f of p.figures) {
        if (
          f.matchedAddIndex !== null &&
          f.matchedAddIndex !== undefined &&
          resolved[f.matchedAddIndex]?.kind === 'add'
        ) {
          figures.push({
            uid: nextUid++,
            addIndex: f.matchedAddIndex,
            pageIndex: p.pageIndex,
            box: f.box.slice() as Box,
            ...(f.printedLabel ? { printedLabel: f.printedLabel } : {}),
            ...(f.confidence ? { confidence: f.confidence } : {}),
          });
        }
      }
    }
  }

  // ---- step 3: question cards ----
  function renderQuestions() {
    qList.innerHTML = '';
    const skips: Delta[] = [];
    resolved.forEach((delta, idx) => {
      if (delta.kind === 'skip') { skips.push(delta); return; }
      qList.appendChild(makeCard(delta, idx));
    });
    if (skips.length) {
      const group = document.createElement('details');
      group.className = 'fs-skip-group';
      const summary = document.createElement('summary');
      summary.className = 'fs-skip-summary';
      summary.textContent = `${skips.length} already in your book`;
      group.appendChild(summary);
      for (const s of skips) {
        const row = document.createElement('div');
        row.className = 'fs-q-before';
        renderLatex(row, s.canonicalText);
        group.appendChild(row);
      }
      qList.appendChild(group);
    }
  }

  function makeCard(delta: Delta, idx: number): HTMLElement {
    const isAdd = delta.kind === 'add';
    const card = document.createElement('div');
    const figs = isAdd ? attachedFor(idx) : [];
    card.className = `fs-q${figs.length ? ' has-fig' : ''}${accepted[idx] ? '' : ' rejected'}`;

    const head = document.createElement('div');
    head.className = 'fs-q-head';
    const tag = document.createElement('span');
    tag.className = `fs-q-tag fs-tag-${delta.kind}`;
    tag.textContent = isAdd ? 'New' : 'Edit';
    const label = document.createElement('span');
    label.className = 'fs-q-label';
    label.textContent = delta.path || '—';
    head.append(tag, label);

    // (!) when a cited figure went unfulfilled (per reference count).
    if (isAdd && figs.length < (delta.figureRefs?.length ?? 0)) {
      const bang = document.createElement('span');
      bang.className = 'fs-q-bang';
      bang.textContent = '(!)';
      bang.title = figuresError
        ? 'Figures unavailable — add manually'
        : 'A cited figure wasn\'t attached — add it manually';
      head.append(bang);
    }
    if (delta.relevance) {
      const rel = document.createElement('span');
      rel.className = 'fs-q-rel';
      rel.textContent = delta.relevance;
      head.append(rel);
    }
    if (isAdd) {
      const add = document.createElement('button');
      add.className = 'fs-q-add fs-ghost-btn';
      add.type = 'button';
      add.textContent = figs.length ? '+ image' : '+ add image';
      add.addEventListener('click', () => openSub(idx, null));
      head.append(add);
    }
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = `fs-q-toggle${accepted[idx] ? ' on' : ''}`;
    toggle.textContent = accepted[idx] ? 'Added ✓' : 'Add';
    toggle.addEventListener('click', () => {
      accepted[idx] = !accepted[idx];
      renderQuestions();
      syncContinue();
    });
    head.append(toggle);
    card.appendChild(head);

    if (isAdd) {
      const body = document.createElement('div');
      body.className = 'fs-q-body';
      body.title = 'Tap to edit';
      renderLatex(body, delta.canonicalText);
      body.addEventListener('click', () => editText(idx, body));
      card.appendChild(body);
    } else {
      // edit: before (existing) → after (editable). We don't have the "before" text
      // (server didn't echo it); show the after as the editable canonical text.
      const after = document.createElement('div');
      after.className = 'fs-q-body';
      after.title = 'Tap to edit';
      renderLatex(after, delta.canonicalText);
      after.addEventListener('click', () => editText(idx, after));
      card.appendChild(after);
    }

    if (isAdd && figs.length) {
      const strip = document.createElement('div');
      strip.className = 'fs-thumbs';
      for (const f of figs) {
        const t = document.createElement('div');
        t.className = 'fs-thumb';
        const im = document.createElement('img');
        im.src = cut(f.pageIndex, f.box, 240);
        im.alt = `figure for ${delta.path}`;
        const edit = document.createElement('button');
        edit.className = 'fs-thumb-btn fs-thumb-edit';
        edit.type = 'button';
        edit.title = 'Edit figure';
        edit.innerHTML = '✎';
        edit.addEventListener('click', (e) => { e.stopPropagation(); openSub(idx, f.uid); });
        const x = document.createElement('button');
        x.className = 'fs-thumb-btn fs-thumb-x';
        x.type = 'button';
        x.title = 'Remove';
        x.textContent = '×';
        x.addEventListener('click', (e) => {
          e.stopPropagation();
          figures = figures.filter((g) => g.uid !== f.uid);
          renderQuestions();
        });
        t.append(im, edit, x);
        strip.appendChild(t);
      }
      card.appendChild(strip);
    }
    return card;
  }

  function editText(idx: number, body: HTMLElement) {
    const ta = document.createElement('textarea');
    ta.className = 'fs-q-edit';
    ta.value = resolved[idx]!.canonicalText;
    ta.rows = Math.min(8, (ta.value.match(/\n/g)?.length ?? 0) + 3);
    body.replaceWith(ta);
    ta.focus();
    const done = () => { resolved[idx]!.canonicalText = ta.value; renderQuestions(); };
    ta.addEventListener('blur', done);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ta.blur(); }
    });
  }

  // ---- needsSection prompts (own container above the cards) ----
  function renderNeedsSection() {
    needsEl.innerHTML = '';
    pendingPrompts = needsSection.length;
    for (const ns of needsSection) {
      const wrap = document.createElement('div');
      wrap.className = 'fs-needs';
      const q = document.createElement('div');
      q.className = 'fs-needs-q';
      const nums = ns.problems.map((p) => p.localLabel).join(', ');
      q.textContent = `Page ${ns.pageIndex + 1} shows problem${ns.problems.length === 1 ? '' : 's'} ${nums} with no chapter/section. Which section are these in?`;
      const input = document.createElement('input');
      input.className = 'fs-needs-input';
      input.placeholder = 'e.g. 1.A';
      const go = document.createElement('button');
      go.className = 'fs-needs-go';
      go.type = 'button';
      go.textContent = 'Set';
      const row = document.createElement('div');
      row.className = 'fs-needs-row';
      row.append(input, go);
      wrap.append(q, row);
      needsEl.appendChild(wrap);
      go.addEventListener('click', () => {
        const prefix = input.value.trim();
        if (!prefix) return;
        sectionAnswers[String(ns.pageIndex)] = prefix;
        input.disabled = true;
        go.disabled = true;
        go.textContent = 'Set ✓';
        pendingPrompts -= 1;
        syncContinue();
        if (pendingPrompts === 0) void refine();
      });
    }
    syncContinue();
  }

  async function refine() {
    const form = new FormData();
    form.append('bookId', bookId);
    for (const f of files) form.append('images', f);
    form.append('currentExtraction', JSON.stringify({ resolved, needsSection }));
    form.append('sectionAnswers', JSON.stringify(sectionAnswers));
    try {
      const res = await fetch('/api/extract/refine', { method: 'POST', body: form });
      if (!res.ok) throw new Error('refine-failed');
      const env = (await res.json()) as Envelope;
      resolved = env.resolved ?? [];
      needsSection = env.needsSection ?? [];
      accepted = resolved.map((d) => d.kind !== 'skip');
      // The resolved array is renumbered — pre-refine figure attachments are stale; drop them
      // (they fall back to the (!) manual-add path). Pages stay in memory for manual adds.
      figures = [];
      renderQuestions();
      if (needsSection.length > 0) renderNeedsSection();
      syncContinue();
    } catch {
      // Keep the current state; surface a soft hint in the first prompt area.
      const hint = document.createElement('div');
      hint.className = 'fs-ex-error';
      hint.textContent = 'Refine failed — add what you have, or try again.';
      qList.prepend(hint);
    }
  }

  function syncContinue() {
    const n = resolved.filter((d, i) => accepted[i] && d.kind !== 'skip').length;
    navNext.textContent = n ? `Continue · ${n}` : 'Continue';
    navNext.disabled = step === 3 && (n === 0 || pendingPrompts > 0);
  }

  // ============================ figure crop ============================
  /** Cut a crop from a decoded rectified page. `maxPx` caps the longer side (thumbnail). */
  function cut(pageIndex: number, box: Box, maxPx: number): string {
    const im = pageImgs[pageIndex];
    if (!im) return '';
    const [x1, y1, x2, y2] = box;
    const bw = Math.max(1, x2 - x1), bh = Math.max(1, y2 - y1);
    const s = Math.min(1, maxPx / Math.max(bw, bh));
    const c = document.createElement('canvas');
    c.width = Math.round(bw * s);
    c.height = Math.round(bh * s);
    try { c.getContext('2d')!.drawImage(im, x1, y1, bw, bh, 0, 0, c.width, c.height); } catch { /* not loaded */ }
    return c.toDataURL('image/jpeg', 0.85);
  }

  /** Bake a full-resolution webp crop blob for commit. */
  function bakeCrop(pageIndex: number, box: Box): Promise<Blob | null> {
    const im = pageImgs[pageIndex];
    if (!im) return Promise.resolve(null);
    const [x1, y1, x2, y2] = box;
    const bw = Math.max(1, Math.round(x2 - x1)), bh = Math.max(1, Math.round(y2 - y1));
    const c = document.createElement('canvas');
    c.width = bw; c.height = bh;
    try { c.getContext('2d')!.drawImage(im, x1, y1, bw, bh, 0, 0, bw, bh); } catch { return Promise.resolve(null); }
    return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/webp', 0.85));
  }

  // ============================ subpage ============================
  function buildSubpage() {
    const img = document.createElement('img');
    img.className = 'fs-page-img';
    img.alt = 'rectified page';
    const overlay = document.createElement('div');
    overlay.className = 'fs-overlay';
    const drawRect = document.createElement('div');
    drawRect.className = 'fs-draw-rect';
    drawRect.hidden = true;
    const content = html`<div class="fs-page-content">${img}${overlay}${drawRect}</div>`;
    const wrap = html`<div class="fs-page-wrap">${content}</div>`;
    const hint = html`<p class="fs-hint">Tap a detected figure, or drag one finger to draw your own — drag the edges to adjust. Pinch with two fingers to zoom and pan.</p>`;
    const body = html`<div class="fs-sp-body">${hint}${wrap}</div>`;
    const cancel = html`<button class="fs-sp-btn" type="button">✕ Cancel</button>` as HTMLButtonElement;
    const title = html`<span class="fs-sp-title">Figure</span>` as HTMLElement;
    const attach = html`<button class="fs-sp-btn strong" type="button" disabled>Attach</button>` as HTMLButtonElement;
    const topbar = html`<header class="fs-sp-topbar">${cancel}${title}${attach}</header>`;
    const root = html`<div class="fs-subpage" hidden>${topbar}${body}</div>` as HTMLElement;
    return { root, img, overlay, drawRect, content, wrap, title, attach, cancel };
  }

  // subpage live state
  let sub: { addIndex: number; editUid: number | null; pageIndex: number; box: Box | null } | null = null;
  let editEl: HTMLElement | null = null;

  subEls.cancel.addEventListener('click', closeSub);
  subEls.attach.addEventListener('click', () => {
    if (!sub || !sub.box) return;
    if (sub.editUid !== null) {
      const f = figures.find((g) => g.uid === sub!.editUid);
      if (f) { f.box = sub.box.slice() as Box; f.pageIndex = sub.pageIndex; }
    } else {
      figures.push({ uid: nextUid++, addIndex: sub.addIndex, pageIndex: sub.pageIndex, box: sub.box.slice() as Box });
    }
    closeSub();
    renderQuestions();
  });

  function openSub(addIndex: number, editUid: number | null) {
    const editFig = editUid !== null ? figures.find((g) => g.uid === editUid) : undefined;
    const pageIndex = editFig ? editFig.pageIndex : 0;
    if (!pageImgs[pageIndex]) return; // no rectified page available (figuresError)
    sub = {
      addIndex,
      editUid,
      pageIndex,
      box: editFig ? (editFig.box.slice() as Box) : null,
    };
    subEls.title.textContent = (editFig ? 'Edit figure · ' : 'Add figure · ') + (resolved[addIndex]?.path ?? '');
    subEls.img.src = pageImgs[pageIndex]!.src;
    subEls.attach.disabled = !sub.box;
    resetZoom();
    renderSub();
    subEls.root.hidden = false;
  }
  function closeSub() { subEls.root.hidden = true; sub = null; editEl = null; }

  function natWH(): [number, number] {
    // Drive geometry from the in-memory rectified dims (seeded synchronously in
    // seedFromScan), NOT the live <img> — on first open its naturalWidth may not
    // be populated yet, which would collapse every box/guide to a 1×1 space.
    if (sub) {
      const d = pageDims[sub.pageIndex];
      if (d) return [d.width, d.height];
    }
    return [subEls.img.naturalWidth || 1, subEls.img.naturalHeight || 1];
  }
  function setGeom(el: HTMLElement, box: Box) {
    const [W, H] = natWH();
    const [x1, y1, x2, y2] = box;
    Object.assign(el.style, {
      left: `${(x1 / W) * 100}%`,
      top: `${(y1 / H) * 100}%`,
      width: `${((x2 - x1) / W) * 100}%`,
      height: `${((y2 - y1) / H) * 100}%`,
    });
  }
  function renderSub() {
    if (!sub) return;
    subEls.overlay.innerHTML = '';
    editEl = null;
    const guides = detectedByPage.get(sub.pageIndex) ?? [];
    for (const gbox of guides) {
      const g = document.createElement('div');
      g.className = 'fs-box guide';
      setGeom(g, gbox);
      g.addEventListener('click', (e) => {
        e.stopPropagation();
        sub!.box = gbox.slice() as Box;
        subEls.attach.disabled = false;
        renderSub();
      });
      subEls.overlay.appendChild(g);
    }
    if (sub.box) {
      const b = document.createElement('div');
      b.className = 'fs-box editing';
      setGeom(b, sub.box);
      (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).forEach((d) => {
        const h = document.createElement('div');
        h.className = `fs-handle fs-h-${d}`;
        h.dataset.dir = d;
        b.appendChild(h);
      });
      subEls.overlay.appendChild(b);
      editEl = b;
    }
  }

  // ---- zoom / pan (ported from the mock) ----
  const MAX_ZOOM = 6;
  let zoom = { scale: 1, x: 0, y: 0 };
  function clampZoom() {
    const r = subEls.wrap.getBoundingClientRect();
    zoom.scale = Math.min(MAX_ZOOM, Math.max(1, zoom.scale));
    zoom.x = Math.min(0, Math.max(r.width - r.width * zoom.scale, zoom.x));
    zoom.y = Math.min(0, Math.max(r.height - r.height * zoom.scale, zoom.y));
  }
  function applyZoom() {
    clampZoom();
    subEls.content.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
    subEls.content.style.setProperty('--z', String(zoom.scale));
  }
  function resetZoom() { zoom = { scale: 1, x: 0, y: 0 }; applyZoom(); }
  function zoomTo(scale: number, lx: number, ly: number) {
    const cx = (lx - zoom.x) / zoom.scale, cy = (ly - zoom.y) / zoom.scale;
    zoom.scale = Math.min(MAX_ZOOM, Math.max(1, scale));
    zoom.x = lx - cx * zoom.scale;
    zoom.y = ly - cy * zoom.scale;
    applyZoom();
  }

  // ---- gestures ----
  let g: { mode: 'draw' | 'move' | 'resize'; dir?: string; start: [number, number]; box: Box | null; cur?: Box } | null = null;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; scale: number; x: number; y: number; mid: { x: number; y: number } } | null = null;
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  function ptNat(e: PointerEvent): [number, number] {
    const r = subEls.wrap.getBoundingClientRect();
    const [W, H] = natWH();
    const fx = ((e.clientX - r.left) - zoom.x) / zoom.scale / r.width;
    const fy = ((e.clientY - r.top) - zoom.y) / zoom.scale / r.height;
    return [Math.min(1, Math.max(0, fx)) * W, Math.min(1, Math.max(0, fy)) * H];
  }
  function cancelDraw() { if (g && g.mode === 'draw') subEls.drawRect.hidden = true; g = null; }
  function startPinch() {
    const p = [...pointers.values()];
    pinch = { dist: dist(p[0]!, p[1]!), scale: zoom.scale, x: zoom.x, y: zoom.y, mid: mid(p[0]!, p[1]!) };
  }
  function updatePinch() {
    const p = [...pointers.values()];
    if (p.length < 2 || !pinch) return;
    const r = subEls.wrap.getBoundingClientRect();
    const m = mid(p[0]!, p[1]!), factor = dist(p[0]!, p[1]!) / (pinch.dist || 1);
    const scale = Math.min(MAX_ZOOM, Math.max(1, pinch.scale * factor));
    const cx = (pinch.mid.x - r.left - pinch.x) / pinch.scale;
    const cy = (pinch.mid.y - r.top - pinch.y) / pinch.scale;
    zoom.scale = scale;
    zoom.x = (m.x - r.left) - cx * scale;
    zoom.y = (m.y - r.top) - cy * scale;
    applyZoom();
  }
  subEls.wrap.addEventListener('pointerdown', (e) => {
    if (subEls.root.hidden || !sub) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) { cancelDraw(); startPinch(); renderSub(); return; }
    const target = e.target as HTMLElement;
    const handle = target.closest('.fs-handle') as HTMLElement | null;
    const editing = target.closest('.fs-box.editing');
    const guide = target.closest('.fs-box.guide');
    if (guide) return; // its click selects
    e.preventDefault();
    subEls.wrap.setPointerCapture(e.pointerId);
    if (handle && sub.box) g = { mode: 'resize', dir: handle.dataset.dir ?? 'se', start: ptNat(e), box: sub.box.slice() as Box };
    else if (editing && sub.box) g = { mode: 'move', start: ptNat(e), box: sub.box.slice() as Box };
    else { g = { mode: 'draw', start: ptNat(e), box: null }; subEls.drawRect.hidden = false; }
  });
  subEls.wrap.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) { updatePinch(); return; }
    if (!g || !sub) return;
    const [W, H] = natWH(), p = ptNat(e), dx = p[0] - g.start[0], dy = p[1] - g.start[1];
    if (g.mode === 'draw') {
      const b = norm([g.start[0], g.start[1], p[0], p[1]]);
      setGeom(subEls.drawRect, b);
      g.cur = b;
      return;
    }
    let b = g.box!.slice() as Box;
    if (g.mode === 'move') {
      const w = b[2] - b[0], h = b[3] - b[1];
      b[0] = Math.min(Math.max(0, b[0] + dx), W - w);
      b[1] = Math.min(Math.max(0, b[1] + dy), H - h);
      b[2] = b[0] + w; b[3] = b[1] + h;
    } else {
      const d = g.dir!;
      if (d.includes('w')) b[0] += dx;
      if (d.includes('e')) b[2] += dx;
      if (d.includes('n')) b[1] += dy;
      if (d.includes('s')) b[3] += dy;
      b = norm(b);
      b[0] = Math.max(0, b[0]); b[1] = Math.max(0, b[1]);
      b[2] = Math.min(W, b[2]); b[3] = Math.min(H, b[3]);
    }
    sub.box = b;
    if (editEl) setGeom(editEl, b);
  });
  function endPointer(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size >= 2) startPinch(); else pinch = null; return; }
    if (!g || !sub) return;
    if (g.mode === 'draw') {
      subEls.drawRect.hidden = true;
      const b = g.cur, [W, H] = natWH();
      if (b && (b[2] - b[0]) > W * 0.02 && (b[3] - b[1]) > H * 0.02) sub.box = b;
    }
    g = null;
    subEls.attach.disabled = !sub.box;
    renderSub();
  }
  subEls.wrap.addEventListener('pointerup', endPointer);
  subEls.wrap.addEventListener('pointercancel', endPointer);
  subEls.wrap.addEventListener('wheel', (e) => {
    if (subEls.root.hidden) return;
    e.preventDefault();
    const r = subEls.wrap.getBoundingClientRect();
    zoomTo(zoom.scale * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // ============================ commit ============================
  async function commit() {
    navNext.disabled = true;
    navNext.textContent = 'Saving…';
    try {
      await runCommit();
      window.history.back();
    } catch {
      navNext.disabled = false;
      navNext.textContent = 'Continue';
      const hint = document.createElement('div');
      hint.className = 'fs-ex-error';
      hint.textContent = 'Saving failed — try again.';
      qList.prepend(hint);
    }
  }

  async function runCommit() {
    // 1. Current saved rows (full list — every existing row must be kept WITH its id, else
    //    planBatchSave deletes it and loses its attempts AND figures).
    const current: Array<{ id: string; label: string; canonicalText: string; relevance?: Relevance }> =
      await fetch(`/api/books/${bookId}/questions`).then((r) => r.json());

    // Map an accepted edit's targetId → its replacement delta.
    const editByTarget = new Map<string, Delta>();
    resolved.forEach((d, i) => {
      if (d.kind === 'edit' && accepted[i] && d.targetId) editByTarget.set(d.targetId, d);
    });

    const put: Array<{ id?: string; label: string; canonicalText: string; relevance?: Relevance }> = [];
    for (const row of current) {
      const ed = editByTarget.get(row.id);
      if (ed) {
        // Mutate the kept row IN PLACE (never append a second id → would shift addSlots).
        put.push({
          id: row.id,
          label: ed.path || row.label,
          canonicalText: ed.canonicalText,
          ...(ed.relevance ? { relevance: ed.relevance } : {}),
        });
      } else {
        // Keep every existing row verbatim, carrying its relevance (omitting it CLEARS it).
        put.push({
          id: row.id,
          label: row.label,
          canonicalText: row.canonicalText,
          ...(row.relevance ? { relevance: row.relevance } : {}),
        });
      }
    }

    // Accepted adds → new entries (no id), appended. Track each one's slot in `put`.
    const addSlots: Array<{ resolvedIndex: number; slot: number }> = [];
    resolved.forEach((d, i) => {
      if (d.kind === 'add' && accepted[i]) {
        addSlots.push({ resolvedIndex: i, slot: put.length });
        put.push({
          label: d.path || '',
          canonicalText: d.canonicalText,
          ...(d.relevance ? { relevance: d.relevance } : {}),
        });
      }
    });

    // 2. PUT — the response echoes incoming order (NOT re-sorted), so saved[slot] aligns.
    const saved: Array<{ id: string }> = await fetch(`/api/books/${bookId}/questions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: put }),
    }).then((r) => r.json());

    // 3. Per accepted add, bake + POST its figures to the now-saved question id.
    let figureFailures = 0;
    for (const { resolvedIndex, slot } of addSlots) {
      const newId = saved[slot]?.id;
      if (!newId) continue;
      for (const f of attachedFor(resolvedIndex)) {
        const blob = await bakeCrop(f.pageIndex, f.box);
        if (!blob) { figureFailures++; continue; }
        const form = new FormData();
        form.append('crop', blob, 'figure.webp');
        if (f.printedLabel) form.append('printedLabel', f.printedLabel);
        if (f.confidence) form.append('confidence', f.confidence);
        const res = await fetch(`/api/questions/${newId}/figures`, { method: 'POST', body: form });
        if (!res.ok) figureFailures++;
      }
    }
    if (figureFailures > 0) {
      // Problems are already saved; surface a soft toast but don't roll back.
      const hint = document.createElement('div');
      hint.className = 'fs-ex-error';
      hint.textContent = `${figureFailures} figure${figureFailures === 1 ? '' : 's'} couldn't be saved.`;
      qList.prepend(hint);
    }
  }

  // ---- boot ----
  showStep(1);

  return page;
}

/** Decode a base64 PNG into a loaded HTMLImageElement (decode-gate for cut/bake). */
function decodeImg(pngBase64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = `data:image/png;base64,${pngBase64}`;
  });
}
