import { ProblemRow } from '@/components/ProblemRow';
import type { ProblemRowData, ProblemRowHandle } from '@/components/ProblemRow';

export interface ProblemsListProps {
  problems?: ProblemRowData[];
  onChange?: () => void;
}

export interface ProblemsListHandle {
  el: HTMLElement;
  addButton: HTMLElement;
  getProblems: () => { label: string; latex: string }[];
}

export function ProblemsList(props: ProblemsListProps): ProblemsListHandle {
  const onChange = props.onChange ?? (() => {});
  const rows: ProblemRowHandle[] = [];

  const host = document.createElement('ol');
  host.className = 'problem-list';
  host.style.cssText = 'list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:0.5rem;';

  function renumber() {
    const children = [...host.children] as HTMLElement[];
    children.forEach((child, i) => {
      const row = rows.find(r => r.el === child);
      if (!row) return;
      if (row.getCustomLabel() == null) {
        row.labelInput.value = String(i + 1);
        row.labelInput.classList.add('auto');
      } else {
        row.labelInput.classList.remove('auto');
      }
    });
  }

  function markChanged() { renumber(); onChange(); }

  function addRow(problem: ProblemRowData = { label: null, latex: '' }, focus = false) {
    const handle = ProblemRow({
      problem,
      onChange: markChanged,
      onDelete: (h) => {
        const i = rows.indexOf(h);
        if (i >= 0) rows.splice(i, 1);
        h.el.remove();
        markChanged();
      },
    });
    rows.push(handle);
    host.appendChild(handle.el);
    makeDraggable(handle);
    renumber();
    if (focus) handle.enterEdit();
  }

  function makeDraggable(handle: ProblemRowHandle) {
    const row = handle.el;
    const dragHandle = row.querySelector('.pr-handle') as HTMLElement;
    if (!dragHandle) return;

    dragHandle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startRect = row.getBoundingClientRect();
      const grabOffsetY = e.clientY - startRect.top;
      let moved = false;

      const spacer = document.createElement('li');
      spacer.className = 'pr-spacer';
      spacer.style.height = startRect.height + 'px';
      host.insertBefore(spacer, row);

      row.classList.add('dragging');
      row.style.width = startRect.width + 'px';
      row.style.left = startRect.left + 'px';
      row.style.top = startRect.top + 'px';
      dragHandle.setPointerCapture(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientY - startRect.top - grabOffsetY) > 3) moved = true;
        row.style.top = (ev.clientY - grabOffsetY) + 'px';
        const dragCenter = ev.clientY - grabOffsetY + startRect.height / 2;
        const others = [...host.querySelectorAll('.pr-row:not(.dragging)')] as HTMLElement[];
        let placed = false;
        for (const other of others) {
          const box = other.getBoundingClientRect();
          if (dragCenter < box.top + box.height / 2) {
            if (spacer.nextElementSibling !== other) host.insertBefore(spacer, other);
            placed = true;
            break;
          }
        }
        if (!placed && host.lastElementChild !== spacer) host.appendChild(spacer);
      };

      const onUp = (ev: PointerEvent) => {
        dragHandle.releasePointerCapture(ev.pointerId);
        host.insertBefore(row, spacer);
        spacer.remove();
        row.classList.remove('dragging');
        row.style.width = '';
        row.style.left = '';
        row.style.top = '';
        // Keep rows array in DOM order
        rows.sort((a, b) => {
          const children = [...host.children];
          return children.indexOf(a.el) - children.indexOf(b.el);
        });
        if (moved) markChanged();
        dragHandle.removeEventListener('pointermove', onMove);
        dragHandle.removeEventListener('pointerup', onUp);
        dragHandle.removeEventListener('pointercancel', onUp);
      };

      dragHandle.addEventListener('pointermove', onMove);
      dragHandle.addEventListener('pointerup', onUp);
      dragHandle.addEventListener('pointercancel', onUp);
    });
  }

  // Add button
  const addButton = document.createElement('button');
  addButton.className = 'add-problem';
  addButton.type = 'button';
  addButton.innerHTML = `<span class="plus" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg></span> Add a problem`;
  addButton.addEventListener('click', () => { addRow({ label: null, latex: '' }, true); markChanged(); });

  // Seed initial problems
  (props.problems ?? []).forEach(p => addRow(p));

  return {
    el: host,
    addButton,
    getProblems: () => rows.map(r => ({
      label: r.labelInput.value.trim(),
      latex: r.getLatex().trim(),
    })),
  };
}
