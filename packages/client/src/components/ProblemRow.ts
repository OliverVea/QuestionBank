import { LatexEditor } from '@/components/LatexEditor';
import './ProblemRow.css';

export interface ProblemRowData {
  label: string | null;
  latex: string;
}

export interface ProblemRowHandle {
  el: HTMLElement;
  labelInput: HTMLInputElement;
  getLatex: () => string;
  getCustomLabel: () => string | null;
  enterEdit: () => void;
}

export interface ProblemRowProps {
  problem: ProblemRowData;
  onChange: () => void;
  onDelete: (handle: ProblemRowHandle) => void;
}

export function ProblemRow(props: ProblemRowProps): ProblemRowHandle {
  let custom: string | null = (props.problem.label != null && props.problem.label !== '') ? props.problem.label : null;
  let latex = props.problem.latex || '';

  const el = document.createElement('li');
  el.className = 'pr-row';

  // Drag handle
  const handle = document.createElement('span');
  handle.className = 'pr-handle';
  handle.setAttribute('aria-label', 'Drag to reorder');
  handle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01"/></svg>`;

  // Label input
  const labelInput = document.createElement('input');
  labelInput.className = 'pr-label auto';
  labelInput.setAttribute('aria-label', 'Problem label');
  labelInput.value = custom ?? '';

  // Body (LatexEditor)
  const body = document.createElement('div');
  body.className = 'pr-body';
  const latexEl = LatexEditor({
    latex,
    onCommit: (next) => { latex = next; props.onChange(); },
  });
  body.appendChild(latexEl);

  // Delete button
  const del = document.createElement('button');
  del.className = 'pr-del';
  del.type = 'button';
  del.setAttribute('aria-label', 'Delete problem');
  del.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M6 6l1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14"/><path d="M10 11v6M14 11v6"/></svg>`;

  el.append(handle, labelInput, body, del);

  const rowHandle: ProblemRowHandle = {
    el,
    labelInput,
    getLatex: () => latex,
    getCustomLabel: () => custom,
    enterEdit: () => (latexEl as any).enterEdit(),
  };

  labelInput.addEventListener('input', () => {
    custom = labelInput.value.trim() === '' ? null : labelInput.value;
    props.onChange();
  });

  del.addEventListener('click', () => props.onDelete(rowHandle));

  return rowHandle;
}
