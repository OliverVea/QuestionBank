// packages/client/tests/unit/components/PhotoBubble.test.ts
import { describe, test, expect, beforeAll } from 'vitest';
import { PhotoBubble } from '@/components/PhotoBubble';

beforeAll(() => {
  // jsdom has no object URLs
  globalThis.URL.createObjectURL = () => 'blob:fake';
});

const png = () => new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });

describe('PhotoBubble', () => {
  test('renders one thumbnail per file as a user bubble', () => {
    const el = PhotoBubble([png(), png()]);
    expect(el.classList.contains('chat-bubble-user')).toBe(true);
    expect(el.classList.contains('photo-bubble')).toBe(true);
    expect(el.querySelectorAll('img.photo-thumb')).toHaveLength(2);
    expect((el.querySelector('img.photo-thumb') as HTMLImageElement).src).toContain('blob:fake');
  });

  test('renders notes when provided', () => {
    const el = PhotoBubble([png()], { notes: 'see line 2' });
    expect(el.querySelector('.photo-notes-text')?.textContent).toBe('see line 2');
  });
});
