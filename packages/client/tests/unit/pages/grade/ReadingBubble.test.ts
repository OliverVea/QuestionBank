// packages/client/tests/unit/pages/grade/ReadingBubble.test.ts
import { describe, test, expect } from 'vitest';
import { ReadingBubble } from '@/pages/grade/ReadingBubble';

describe('ReadingBubble', () => {
  test('renders an agent bubble with a label and the reading text', () => {
    const el = ReadingBubble('x = 4 and y = 2');
    expect(el.classList.contains('chat-bubble')).toBe(true);
    expect(el.classList.contains('chat-bubble-agent')).toBe(true);
    expect(el.classList.contains('reading-bubble')).toBe(true);
    expect(el.querySelector('.reading-label')?.textContent).toBe("Here's what I read");
    expect(el.querySelector('.reading-body')?.textContent).toContain('x = 4');
  });
});
