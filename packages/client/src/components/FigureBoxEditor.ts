import { html } from '@/lib/html';
// The editor's `fs-` styles live with the scan wizard it was cut out of.
import '@/pages/FigureScanPage.css';

/** [x1, y1, x2, y2] in the page image's own pixels. */
export type Box = [number, number, number, number];

/** One page the editor can show: the decoded image, its pixel size and the detected figures. */
export interface EditorPage {
  img: HTMLImageElement;
  width: number;
  height: number;
  guides: Box[];
}

export interface OpenOptions {
  title: string;
  /** Page to start on. Defaults to the first available page. */
  pageIndex?: number;
  /** An existing box to adjust, or null to pick or draw a new one. */
  box?: Box | null;
  onAttach: (pageIndex: number, box: Box) => void;
}

export interface FigureBoxEditor {
  /** The full-screen editor element; mount it once inside the page. Hidden until opened. */
  root: HTMLElement;
  /** Open the editor. Returns false (and stays closed) when no page is available. */
  open(opts: OpenOptions): boolean;
  close(): void;
}

const norm = (b: Box): Box => [
  Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3]),
];

const MAX_ZOOM = 6;

/**
 * A full-screen picker for one figure box on a page photo: tap a detected figure, or draw
 * one and drag its edges; pinch or scroll to zoom. With several pages, arrows switch page.
 * `getPages` is read on every open, so the caller can add pages later.
 */
export function createFigureBoxEditor(getPages: () => Array<EditorPage | undefined>): FigureBoxEditor {
  const img = document.createElement('img');
  img.className = 'fs-page-img';
  img.alt = 'page';
  const overlay = document.createElement('div');
  overlay.className = 'fs-overlay';
  const drawRect = document.createElement('div');
  drawRect.className = 'fs-draw-rect';
  drawRect.hidden = true;
  const content = html`<div class="fs-page-content">${img}${overlay}${drawRect}</div>`;
  const wrap = html`<div class="fs-page-wrap">${content}</div>`;
  const hint = html`<p class="fs-hint">Tap a detected figure, or drag one finger to draw your own — drag the edges to adjust. Pinch with two fingers to zoom and pan.</p>`;
  const prevPage = html`<button class="fs-ghost-btn" type="button" title="Previous page">‹</button>` as HTMLButtonElement;
  const nextPage = html`<button class="fs-ghost-btn" type="button" title="Next page">›</button>` as HTMLButtonElement;
  const pageLabel = html`<span class="fs-sp-page-label"></span>` as HTMLElement;
  const pager = html`<div class="fs-sp-pager" hidden>${prevPage}${pageLabel}${nextPage}</div>` as HTMLElement;
  const body = html`<div class="fs-sp-body">${hint}${pager}${wrap}</div>`;
  const cancel = html`<button class="fs-sp-btn" type="button">✕ Cancel</button>` as HTMLButtonElement;
  const title = html`<span class="fs-sp-title">Figure</span>` as HTMLElement;
  const attach = html`<button class="fs-sp-btn strong" type="button" disabled>Attach</button>` as HTMLButtonElement;
  const topbar = html`<header class="fs-sp-topbar">${cancel}${title}${attach}</header>`;
  const root = html`<div class="fs-subpage" hidden>${topbar}${body}</div>` as HTMLElement;

  // live state while open
  let sub: { pageIndex: number; box: Box | null; onAttach: OpenOptions['onAttach'] } | null = null;
  let pages: Array<EditorPage | undefined> = [];
  let editEl: HTMLElement | null = null;

  const available = (): number[] => pages.flatMap((p, i) => (p ? [i] : []));

  function close() { root.hidden = true; sub = null; editEl = null; }

  cancel.addEventListener('click', close);
  attach.addEventListener('click', () => {
    if (!sub || !sub.box) return;
    const { pageIndex, box, onAttach } = sub;
    close();
    onAttach(pageIndex, box.slice() as Box);
  });

  function showPage(pageIndex: number, box: Box | null) {
    if (!sub) return;
    sub.pageIndex = pageIndex;
    sub.box = box;
    img.src = pages[pageIndex]!.img.src;
    attach.disabled = !sub.box;
    const idx = available();
    pager.hidden = idx.length < 2;
    pageLabel.textContent = `Page ${idx.indexOf(pageIndex) + 1} of ${idx.length}`;
    resetZoom();
    renderSub();
  }
  function stepPage(delta: number) {
    if (!sub) return;
    const idx = available();
    const at = idx.indexOf(sub.pageIndex);
    const next = idx[(at + delta + idx.length) % idx.length];
    if (next !== undefined && next !== sub.pageIndex) showPage(next, null);
  }
  prevPage.addEventListener('click', () => stepPage(-1));
  nextPage.addEventListener('click', () => stepPage(1));

  function open(opts: OpenOptions): boolean {
    pages = getPages();
    const idx = available();
    const pageIndex = opts.pageIndex !== undefined && pages[opts.pageIndex] ? opts.pageIndex : idx[0];
    if (pageIndex === undefined) return false; // no page to pick from
    sub = { pageIndex, box: null, onAttach: opts.onAttach };
    title.textContent = opts.title;
    root.hidden = false;
    showPage(pageIndex, opts.box ? (opts.box.slice() as Box) : null);
    return true;
  }

  function natWH(): [number, number] {
    // Drive geometry from the page's known pixel size, NOT the live <img> — on first open its
    // naturalWidth may not be populated yet, which would collapse every box/guide to a 1×1 space.
    const p = sub ? pages[sub.pageIndex] : undefined;
    if (p) return [p.width, p.height];
    return [img.naturalWidth || 1, img.naturalHeight || 1];
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
    overlay.innerHTML = '';
    editEl = null;
    const guides = pages[sub.pageIndex]?.guides ?? [];
    for (const gbox of guides) {
      const g = document.createElement('div');
      g.className = 'fs-box guide';
      setGeom(g, gbox);
      g.addEventListener('click', (e) => {
        e.stopPropagation();
        sub!.box = gbox.slice() as Box;
        attach.disabled = false;
        renderSub();
      });
      overlay.appendChild(g);
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
      overlay.appendChild(b);
      editEl = b;
    }
  }

  // ---- zoom / pan (ported from the mock) ----
  let zoom = { scale: 1, x: 0, y: 0 };
  function clampZoom() {
    const r = wrap.getBoundingClientRect();
    zoom.scale = Math.min(MAX_ZOOM, Math.max(1, zoom.scale));
    zoom.x = Math.min(0, Math.max(r.width - r.width * zoom.scale, zoom.x));
    zoom.y = Math.min(0, Math.max(r.height - r.height * zoom.scale, zoom.y));
  }
  function applyZoom() {
    clampZoom();
    content.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
    content.style.setProperty('--z', String(zoom.scale));
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
    const r = wrap.getBoundingClientRect();
    const [W, H] = natWH();
    const fx = ((e.clientX - r.left) - zoom.x) / zoom.scale / r.width;
    const fy = ((e.clientY - r.top) - zoom.y) / zoom.scale / r.height;
    return [Math.min(1, Math.max(0, fx)) * W, Math.min(1, Math.max(0, fy)) * H];
  }
  function cancelDraw() { if (g && g.mode === 'draw') drawRect.hidden = true; g = null; }
  function startPinch() {
    const p = [...pointers.values()];
    pinch = { dist: dist(p[0]!, p[1]!), scale: zoom.scale, x: zoom.x, y: zoom.y, mid: mid(p[0]!, p[1]!) };
  }
  function updatePinch() {
    const p = [...pointers.values()];
    if (p.length < 2 || !pinch) return;
    const r = wrap.getBoundingClientRect();
    const m = mid(p[0]!, p[1]!), factor = dist(p[0]!, p[1]!) / (pinch.dist || 1);
    const scale = Math.min(MAX_ZOOM, Math.max(1, pinch.scale * factor));
    const cx = (pinch.mid.x - r.left - pinch.x) / pinch.scale;
    const cy = (pinch.mid.y - r.top - pinch.y) / pinch.scale;
    zoom.scale = scale;
    zoom.x = (m.x - r.left) - cx * scale;
    zoom.y = (m.y - r.top) - cy * scale;
    applyZoom();
  }
  wrap.addEventListener('pointerdown', (e) => {
    if (root.hidden || !sub) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) { cancelDraw(); startPinch(); renderSub(); return; }
    const target = e.target as HTMLElement;
    const handle = target.closest('.fs-handle') as HTMLElement | null;
    const editing = target.closest('.fs-box.editing');
    const guide = target.closest('.fs-box.guide');
    if (guide) return; // its click selects
    e.preventDefault();
    wrap.setPointerCapture(e.pointerId);
    if (handle && sub.box) g = { mode: 'resize', dir: handle.dataset.dir ?? 'se', start: ptNat(e), box: sub.box.slice() as Box };
    else if (editing && sub.box) g = { mode: 'move', start: ptNat(e), box: sub.box.slice() as Box };
    else { g = { mode: 'draw', start: ptNat(e), box: null }; drawRect.hidden = false; }
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) { updatePinch(); return; }
    if (!g || !sub) return;
    const [W, H] = natWH(), p = ptNat(e), dx = p[0] - g.start[0], dy = p[1] - g.start[1];
    if (g.mode === 'draw') {
      const b = norm([g.start[0], g.start[1], p[0], p[1]]);
      setGeom(drawRect, b);
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
      drawRect.hidden = true;
      const b = g.cur, [W, H] = natWH();
      if (b && (b[2] - b[0]) > W * 0.02 && (b[3] - b[1]) > H * 0.02) sub.box = b;
    }
    g = null;
    attach.disabled = !sub.box;
    renderSub();
  }
  wrap.addEventListener('pointerup', endPointer);
  wrap.addEventListener('pointercancel', endPointer);
  wrap.addEventListener('wheel', (e) => {
    if (root.hidden) return;
    e.preventDefault();
    const r = wrap.getBoundingClientRect();
    zoomTo(zoom.scale * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  return { root, open, close };
}
