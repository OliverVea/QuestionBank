// packages/client/src/pages/grade/UserBubble.ts
import { ChatBubble } from '@/components/ChatBubble';
import { renderLatex } from '@/lib/latex';

const PENCIL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
  stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9" />
  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>`;

export interface UserBubbleData { id: number; text: string }
export interface UserBubbleOpts {
  editable: boolean;
  editing: boolean;
  onEdit: (id: number) => void;
  onSave: (id: number, text: string) => void;
  onCancel: () => void;
}

/** A user turn: display (with optional Edit affordance) or inline editor. */
export function UserBubble(turn: UserBubbleData, opts: UserBubbleOpts): HTMLElement {
  const el = ChatBubble('user');

  if (opts.editing) {
    const ta = document.createElement('textarea');
    ta.className = 'bubble-editor';
    ta.value = turn.text;

    const actions = document.createElement('div');
    actions.className = 'bubble-edit-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'bubble-btn bubble-cancel'; cancel.textContent = 'Cancel';
    const save = document.createElement('button');
    save.type = 'button'; save.className = 'bubble-btn bubble-save'; save.textContent = 'Save';
    cancel.addEventListener('click', () => opts.onCancel());
    save.addEventListener('click', () => {
      const v = ta.value.trim();
      if (!v) return;
      opts.onSave(turn.id, v);
    });
    actions.append(cancel, save);
    el.append(ta, actions);
    queueMicrotask(() => ta.focus());
    return el;
  }

  const body = document.createElement('div');
  renderLatex(body, turn.text, '');
  el.appendChild(body);

  if (opts.editable) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'bubble-edit';
    edit.innerHTML = PENCIL + '<span>Edit</span>';
    edit.setAttribute('aria-label', 'Edit your message');
    edit.addEventListener('click', () => opts.onEdit(turn.id));
    el.appendChild(edit);
  }
  return el;
}
