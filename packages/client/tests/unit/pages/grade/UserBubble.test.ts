// packages/client/tests/unit/pages/grade/UserBubble.test.ts
import { describe, test, expect, vi } from 'vitest';
import { UserBubble } from '@/pages/grade/UserBubble';

describe('UserBubble', () => {
  test('display mode shows the text and an Edit affordance when editable', () => {
    const onEdit = vi.fn();
    const el = UserBubble({ id: 1, text: 'x = 4' }, { editable: true, editing: false, onEdit, onSave: () => {}, onCancel: () => {} });
    expect(el.classList.contains('chat-bubble-user')).toBe(true);
    expect(el.textContent).toContain('x = 4');
    const edit = el.querySelector('.bubble-edit') as HTMLButtonElement;
    expect(edit).not.toBeNull();
    edit.click();
    expect(onEdit).toHaveBeenCalledWith(1);
  });

  test('no Edit affordance when not editable', () => {
    const el = UserBubble({ id: 1, text: 'x = 4' }, { editable: false, editing: false, onEdit: () => {}, onSave: () => {}, onCancel: () => {} });
    expect(el.querySelector('.bubble-edit')).toBeNull();
  });

  test('editing mode shows a textarea + Save/Cancel and wires them', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const el = UserBubble({ id: 1, text: 'x = 4' }, { editable: true, editing: true, onEdit: () => {}, onSave, onCancel });
    const ta = el.querySelector('textarea.bubble-editor') as HTMLTextAreaElement;
    expect(ta.value).toBe('x = 4');
    ta.value = 'x = 5';
    (el.querySelector('.bubble-save') as HTMLButtonElement).click();
    expect(onSave).toHaveBeenCalledWith(1, 'x = 5');
    (el.querySelector('.bubble-cancel') as HTMLButtonElement).click();
    expect(onCancel).toHaveBeenCalled();
  });

  test('Save with empty text does not fire onSave', () => {
    const onSave = vi.fn();
    const el = UserBubble({ id: 1, text: 'x' }, { editable: true, editing: true, onEdit: () => {}, onSave, onCancel: () => {} });
    (el.querySelector('textarea.bubble-editor') as HTMLTextAreaElement).value = '   ';
    (el.querySelector('.bubble-save') as HTMLButtonElement).click();
    expect(onSave).not.toHaveBeenCalled();
  });
});
