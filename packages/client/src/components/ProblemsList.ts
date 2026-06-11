import { html } from '@/lib/html';
import { ProblemRow, type ProblemRowHandle } from '@/components/ProblemRow';
import './ProblemsList.css';

export interface Problem {
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
}

export function ProblemsList({ problems = [], onChange }: ProblemsListProps = {}): ProblemsListHandle {
  const rows: ProblemRowHandle[] = [];
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
        if (i >= 0) rows.splice(i, 1);
        handle.el.remove();
        notify();
      },
    });
    rows.push(handle);
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
        // Sync rows array to DOM order.
        rows.sort((a, b) => {
          const children = [...list.children];
          return children.indexOf(a.el) - children.indexOf(b.el);
        });
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

  // Seed initial problems.
  for (const p of problems) addRow(p);

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
    ${list}
    ${addBtn}
  </div>`;

  return {
    el: wrapper,
    getProblems: () => rows.map(r => ({ label: r.getLabel(), latex: r.getLatex() })),
  };
}
