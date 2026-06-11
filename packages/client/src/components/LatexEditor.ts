import { html } from '@/lib/html';
import { renderLatex } from '@/lib/latex';
import './LatexEditor.css';

export interface LatexEditorProps {
  /** Initial LaTeX source. */
  latex: string;
  /** Called when the user commits an edit (Enter, Ctrl+Enter, blur). */
  onCommit: (newLatex: string) => void;
  placeholder?: string;
}

/**
 * Editable LaTeX card: rendered KaTeX view by default, tap to switch to raw
 * edit mode. Commits on Enter (without Shift), Ctrl+Enter, or blur. Escape
 * cancels. Ported from docs/mocks/problems-list.js enterEdit/commitEdit.
 */
export function LatexEditor({ latex, onCommit, placeholder }: LatexEditorProps): HTMLElement {
  let current = latex;

  const rendered = html`<div class="le-rendered"></div>`;
  const editor = document.createElement('textarea');
  editor.className = 'le-editor';
  editor.rows = 2;
  editor.placeholder = placeholder ?? 'Problem statement in LaTeX, e.g. $\\int_0^\\infty e^{-x^2}\\,dx$';
  editor.hidden = true;

  const wrapper = html`<div class="latex-editor">
    ${rendered}
    ${editor}
  </div>`;

  renderLatex(rendered, current, placeholder);

  function enterEdit() {
    editor.value = current;
    editor.hidden = false;
    rendered.hidden = true;
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  }

  function commitEdit() {
    if (editor.hidden) return;
    const next = editor.value;
    const changed = next !== current;
    current = next;
    editor.hidden = true;
    rendered.hidden = false;
    renderLatex(rendered, current, placeholder);
    if (changed) onCommit(current);
  }

  function cancelEdit() {
    editor.value = current;
    editor.hidden = true;
    rendered.hidden = false;
  }

  rendered.addEventListener('click', enterEdit);
  editor.addEventListener('blur', commitEdit);
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  });

  /** Programmatically enter edit mode (e.g. when a new blank row is added). */
  (wrapper as HTMLElement & { enterEdit: () => void }).enterEdit = enterEdit;

  return wrapper;
}
