import { renderContent } from '../render/content.js';

export interface LatexEditorOptions {
  value: string;
  /**
   * true  — textarea + live KaTeX preview (always editable; for confirm step / manage edit)
   * false — rendered view only; clicking switches to a textarea + commit button (grading chat)
   */
  editable: boolean;
  /** Called on every keystroke while in edit mode. */
  onChange?: (value: string) => void;
  /** Called when the user clicks "Done" after tap-to-edit (editable:false mode only). */
  onCommit?: (value: string) => void;
}

export interface LatexEditor {
  element: HTMLElement;
  getValue(): string;
  setValue(value: string): void;
}

export function createLatexEditor(opts: LatexEditorOptions): LatexEditor {
  const element = document.createElement('div');
  element.className = 'latex-editor';

  let current = opts.value;

  if (opts.editable) {
    return buildAlwaysEditable(element, current, opts);
  } else {
    return buildTapToEdit(element, current, opts);
  }
}

// --- Always-editable mode (textarea + live preview) ---

function buildAlwaysEditable(
  element: HTMLElement,
  initial: string,
  opts: LatexEditorOptions,
): LatexEditor {
  let current = initial;

  const textarea = document.createElement('textarea');
  textarea.className = 'latex-editor-textarea';
  textarea.value = current;

  const preview = document.createElement('div');
  preview.className = 'latex-editor-preview qbody';

  function update(): void {
    current = textarea.value;
    renderContent(preview, current);
    opts.onChange?.(current);
  }

  textarea.addEventListener('input', update);
  renderContent(preview, current);

  element.append(textarea, preview);

  return {
    element,
    getValue: () => current,
    setValue(value: string): void {
      current = value;
      textarea.value = value;
      renderContent(preview, value);
    },
  };
}

// --- Tap-to-edit mode (rendered view → textarea on click) ---

function buildTapToEdit(
  element: HTMLElement,
  initial: string,
  opts: LatexEditorOptions,
): LatexEditor {
  let current = initial;

  function showRendered(): void {
    element.innerHTML = '';
    const rendered = document.createElement('div');
    rendered.className = 'latex-editor-rendered';
    rendered.title = 'Tap to edit';
    renderContent(rendered, current);
    rendered.addEventListener('click', showEditing);
    element.appendChild(rendered);
  }

  function showEditing(): void {
    element.innerHTML = '';

    const textarea = document.createElement('textarea');
    textarea.className = 'latex-editor-textarea';
    textarea.value = current;
    textarea.addEventListener('input', () => {
      current = textarea.value;
      opts.onChange?.(current);
    });

    const commit = document.createElement('button');
    commit.type = 'button';
    commit.className = 'btn latex-editor-commit';
    commit.textContent = 'Done';
    commit.addEventListener('click', () => {
      current = textarea.value;
      opts.onCommit?.(current);
      showRendered();
    });

    element.append(textarea, commit);
    textarea.focus();
  }

  showRendered();

  return {
    element,
    getValue: () => current,
    setValue(value: string): void {
      current = value;
      // If currently showing the rendered view, re-render it.
      const rendered = element.querySelector('.latex-editor-rendered');
      if (rendered) {
        renderContent(rendered as HTMLElement, value);
      } else {
        // In edit mode — update textarea value too.
        const ta = element.querySelector<HTMLTextAreaElement>('.latex-editor-textarea');
        if (ta) ta.value = value;
      }
    },
  };
}
