import { html } from '@/lib/html';
import { LatexEditor } from '@/components/LatexEditor';
import type { Relevance } from '@/lib/types';
import './ProblemRow.css';

export type { Relevance } from '@/lib/types';

export interface ProblemRowProps {
  label: string;
  latex: string;
  relevance?: Relevance;
  /** Called when label, latex, or relevance changes. */
  onChange: () => void;
  /** Called when the user clicks the trash button. */
  onDelete: () => void;
}

export interface ProblemRowHandle {
  el: HTMLElement;
  getLabel: () => string;
  getLatex: () => string;
  getRelevance: () => Relevance | undefined;
  setAutoLabel: (index: number) => void;
  isCustomLabel: () => boolean;
  enterEdit: () => void;
}

export function ProblemRow({ label, latex, relevance, onChange, onDelete }: ProblemRowProps): ProblemRowHandle {
  let customLabel: string | null = label || null;
  let currentLatex = latex;
  let currentRelevance: Relevance | undefined = relevance;

  const labelInput = document.createElement('input');
  labelInput.className = 'pr-label';
  labelInput.setAttribute('aria-label', 'Problem label');
  labelInput.value = label;

  const latexEditor = LatexEditor({
    latex,
    onCommit: (newLatex) => { currentLatex = newLatex; onChange(); },
    placeholder: 'Tap to write the problem (LaTeX)…',
  });

  // Relevance dropdown
  const relevanceSelect = document.createElement('select');
  relevanceSelect.className = 'pr-relevance';
  relevanceSelect.setAttribute('aria-label', 'Relevance to learning goal');
  relevanceSelect.innerHTML = `<option value="">—</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>`;
  relevanceSelect.value = relevance ?? '';
  syncRelevanceClass();

  relevanceSelect.addEventListener('change', () => {
    currentRelevance = (relevanceSelect.value as Relevance) || undefined;
    syncRelevanceClass();
    onChange();
  });

  function syncRelevanceClass() {
    relevanceSelect.classList.remove('rel-high', 'rel-medium', 'rel-low');
    if (relevanceSelect.value) relevanceSelect.classList.add(`rel-${relevanceSelect.value}`);
  }

  const handle = html`<span class="pr-handle" aria-label="Drag to reorder">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" />
    </svg>
  </span>`;

  const del = html`<button class="pr-del" type="button" aria-label="Delete problem">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M6 6l1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  </button>`;

  const row = html`<li class="pr-row">
    ${handle}
    ${labelInput}
    ${latexEditor}
    ${relevanceSelect}
    ${del}
  </li>`;

  // Label editing: non-empty becomes custom; empty reverts to auto.
  labelInput.addEventListener('input', () => {
    customLabel = labelInput.value.trim() === '' ? null : labelInput.value;
    onChange();
  });

  del.addEventListener('click', (e) => { e.stopPropagation(); onDelete(); });

  return {
    el: row,
    getLabel: () => labelInput.value.trim(),
    getLatex: () => currentLatex,
    getRelevance: () => currentRelevance,
    setAutoLabel: (index: number) => {
      if (customLabel == null) {
        labelInput.value = String(index);
        labelInput.classList.add('auto');
      } else {
        labelInput.classList.remove('auto');
      }
    },
    isCustomLabel: () => customLabel != null,
    enterEdit: () => {
      (latexEditor as HTMLElement & { enterEdit?: () => void }).enterEdit?.();
    },
  };
}
