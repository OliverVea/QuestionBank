import { html } from '@/lib/html';
import { ProblemRow, type ProblemRowHandle } from '@/components/ProblemRow';
import { PhotoReviewModal } from '@/components/PhotoReviewModal';
import { stashPhotos } from '@/lib/photo-transfer';
import './ProblemsList.css';

const SCAN_ACCEPTED_KEY = 'qb-scan-accepted';

export interface Problem {
  id?: string;
  label: string;
  latex: string;
}

export interface ProblemsListProps {
  problems?: Problem[];
  onChange?: () => void;
}

export interface ProblemsListHandle {
  el: HTMLElement;
  getProblems: () => Problem[];
  addRow: (problem?: Problem, focus?: boolean) => void;
}

export function ProblemsList({ problems = [], onChange }: ProblemsListProps = {}): ProblemsListHandle {
  const rows: ProblemRowHandle[] = [];
  const rowIds: (string | undefined)[] = [];
  const list = document.createElement('ol');
  list.className = 'problem-list';

  const notify = () => { renumber(); onChange?.(); };

  function renumber() {
    rows.forEach((r, i) => r.setAutoLabel(i + 1));
  }

  function addRow(problem: Problem = { label: '', latex: '' }, focus = false) {
    const handle = ProblemRow({
      label: problem.label,
      latex: problem.latex,
      onChange: notify,
      onDelete: () => {
        const i = rows.indexOf(handle);
        if (i >= 0) { rows.splice(i, 1); rowIds.splice(i, 1); }
        handle.el.remove();
        notify();
      },
    });
    rows.push(handle);
    rowIds.push(problem.id);
    list.appendChild(handle.el);
    makeDraggable(handle);
    renumber();
    if (focus) handle.enterEdit();
  }

  function makeDraggable(row: ProblemRowHandle) {
    const dragHandle = row.el.querySelector('.pr-handle') as HTMLElement;
    if (!dragHandle) return;

    dragHandle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startRect = row.el.getBoundingClientRect();
      const grabOffsetY = e.clientY - startRect.top;
      let moved = false;

      const spacer = document.createElement('li');
      spacer.className = 'pr-spacer';
      spacer.style.height = startRect.height + 'px';
      list.insertBefore(spacer, row.el);

      row.el.classList.add('dragging');
      row.el.style.width = startRect.width + 'px';
      row.el.style.left = startRect.left + 'px';
      row.el.style.top = startRect.top + 'px';
      dragHandle.setPointerCapture(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientY - startRect.top - grabOffsetY) > 3) moved = true;
        row.el.style.top = (ev.clientY - grabOffsetY) + 'px';
        const dragCenter = ev.clientY - grabOffsetY + startRect.height / 2;
        const others = [...list.querySelectorAll('.pr-row:not(.dragging)')] as HTMLElement[];
        let placed = false;
        for (const other of others) {
          const box = other.getBoundingClientRect();
          if (dragCenter < box.top + box.height / 2) {
            if (spacer.nextElementSibling !== other) list.insertBefore(spacer, other);
            placed = true;
            break;
          }
        }
        if (!placed && list.lastElementChild !== spacer) list.appendChild(spacer);
      };

      const onUp = (ev: PointerEvent) => {
        dragHandle.releasePointerCapture(ev.pointerId);
        list.insertBefore(row.el, spacer);
        spacer.remove();
        row.el.classList.remove('dragging');
        row.el.style.width = '';
        row.el.style.left = '';
        row.el.style.top = '';
        // Sync rows and rowIds arrays to match the new DOM order.
        const children = [...list.children];
        const order = rows.map((r) => children.indexOf(r.el));
        const sortedRows = rows.map((_, i) => ({ row: rows[i]!, id: rowIds[i], order: order[i]! }));
        sortedRows.sort((a, b) => a.order - b.order);
        rows.length = 0;
        rowIds.length = 0;
        for (const s of sortedRows) { rows.push(s.row); rowIds.push(s.id); }
        if (moved) notify();
        dragHandle.removeEventListener('pointermove', onMove);
        dragHandle.removeEventListener('pointerup', onUp);
        dragHandle.removeEventListener('pointercancel', onUp);
      };

      dragHandle.addEventListener('pointermove', onMove);
      dragHandle.addEventListener('pointerup', onUp);
      dragHandle.addEventListener('pointercancel', onUp);
    });
  }

  // --- Scan problems: navigate to the scan page ---
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.multiple = true;
  fileInput.hidden = true;

  const scanBtn = html`<button class="scan-problems" type="button">
    <span class="cam" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 8a2 2 0 0 1 2-2h2l1.2-1.6A2 2 0 0 1 11.8 4h.4a2 2 0 0 1 1.6.8L15 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        <circle cx="12" cy="12.5" r="3.2" />
      </svg>
    </span>
    Scan a problems page
  </button>`;

  scanBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const files = fileInput.files;
    if (!files?.length) return;
    const selected = [...files];
    fileInput.value = '';

    const modal = PhotoReviewModal({
      initialFiles: selected,
      onPost({ files: posted, notes }) {
        if (!posted.length) return;
        stashPhotos({ files: posted, notes });
        window.location.hash = '#/scan-problems';
      },
      onCancel() { /* stay on page */ },
    });
    document.body.appendChild(modal);
  });

  // Check for returned problems from scan page.
  function checkForReturnedProblems() {
    const raw = sessionStorage.getItem(SCAN_ACCEPTED_KEY);
    if (!raw) return;
    sessionStorage.removeItem(SCAN_ACCEPTED_KEY);
    try {
      const accepted: Problem[] = JSON.parse(raw);
      for (const p of accepted) addRow(p);
      notify();
    } catch { /* ignore malformed */ }
  }

  // Seed initial problems.
  for (const p of problems) addRow(p);

  // Check on mount for returned scan results.
  checkForReturnedProblems();

  const addBtn = html`<button class="add-problem" type="button">
    <span class="plus" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 5v14" /><path d="M5 12h14" />
      </svg>
    </span>
    Add a problem
  </button>`;
  addBtn.addEventListener('click', () => { addRow({ label: '', latex: '' }, true); notify(); });

  const wrapper = html`<div class="problems">
    <div class="problems-head"><h2>Problems</h2></div>
    ${scanBtn}
    ${fileInput}
    ${list}
    ${addBtn}
  </div>`;

  return {
    el: wrapper,
    getProblems: () => rows.map((r, i) => {
      const p: Problem = { label: r.getLabel(), latex: r.getLatex() };
      if (rowIds[i]) p.id = rowIds[i];
      return p;
    }),
    addRow,
  };
}
