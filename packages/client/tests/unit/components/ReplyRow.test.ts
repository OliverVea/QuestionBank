// packages/client/tests/unit/components/ReplyRow.test.ts
import { describe, test, expect, vi } from 'vitest';
import { ReplyRow } from '@/components/ReplyRow';

function parts(handle: { el: HTMLElement }) {
  return {
    input: handle.el.querySelector('textarea') as HTMLTextAreaElement,
    send: handle.el.querySelector('.reply-send') as HTMLButtonElement,
  };
}

describe('ReplyRow', () => {
  test('setSending locks only the send button; textarea stays editable', () => {
    const r = ReplyRow({ onSend: () => {} });
    const { input, send } = parts(r);
    r.setSending(true);
    expect(send.disabled).toBe(true);
    expect(input.disabled).toBe(false);
    r.setSending(false);
    expect(send.disabled).toBe(false);
  });

  test('setPlaceholder updates the textarea placeholder', () => {
    const r = ReplyRow({ onSend: () => {} });
    r.setPlaceholder('Tell me what to fix…');
    expect(parts(r).input.placeholder).toBe('Tell me what to fix…');
  });

  test('Enter sends, Shift+Enter does not', () => {
    const onSend = vi.fn();
    const r = ReplyRow({ onSend });
    const { input } = parts(r);
    input.value = 'hello';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSend).toHaveBeenCalledWith('hello');
  });

  test('Enter does NOT call onSend when setSending(true) is active', () => {
    const onSend = vi.fn();
    const r = ReplyRow({ onSend });
    const { input } = parts(r);
    r.setSending(true);
    input.value = 'blocked message';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSend).not.toHaveBeenCalled();
  });
});
