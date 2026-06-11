import { renderLatex } from '@/lib/latex';
import './LatexEditor.css';

export interface LatexEditorProps {
  latex: string;
  onCommit: (newLatex: string) => void;
}

/**
 * A card that toggles between rendered KaTeX view and raw-edit mode.
 * Tap rendered → textarea with raw source → Enter/blur commits → re-renders.
 * Escape cancels. Shift+Enter inserts a newline.
 */
export function LatexEditor(props: LatexEditorProps): HTMLElement {
  let latex = props.latex;

  const rendered = document.createElement('div');
  rendered.className = 'le-rendered';

  const editor = document.createElement('textarea');
  editor.className = 'le-editor';
  editor.rows = 2;
  editor.placeholder = 'Problem statement in LaTeX, e.g. $\\\\int_0^\\\\infty e^{-x^2}\\\\,dx$';
  editor.hidden = true;

  const el = document.createElement('div');
  el.append(rendered, editor);

  renderLatex(rendered, latex);

  function enterEdit() {
    editor.value = latex;
    editor.hidden = false;
    rendered.hidden = true;
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  }

  function commitEdit() {
    if (editor.hidden) return;
    const next = editor.value;
    const changed = next !== latex;
    latex = next;
    editor.hidden = true;
    rendered.hidden = false;
    renderLatex(rendered, latex);
    if (changed) props.onCommit(latex);
  }

  rendered.addEventListener('click', enterEdit);
  editor.addEventListener('blur', commitEdit);
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); editor.value = latex; commitEdit(); }
  });

  // Public method to enter edit (used when creating new blank rows)
  (el as any).enterEdit = enterEdit;
  return el;
}
