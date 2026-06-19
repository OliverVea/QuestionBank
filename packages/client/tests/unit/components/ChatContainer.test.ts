// packages/client/tests/unit/components/ChatContainer.test.ts
import { describe, test, expect } from 'vitest';
import { ChatContainer } from '@/components/ChatContainer';

describe('ChatContainer', () => {
  test('clear() removes all children', () => {
    const c = ChatContainer();
    c.el.appendChild(document.createElement('div'));
    c.el.appendChild(document.createElement('div'));
    expect(c.el.children).toHaveLength(2);
    c.clear();
    expect(c.el.children).toHaveLength(0);
  });

  test('scrollToTop sets scrollTop to 0', () => {
    const c = ChatContainer();
    c.el.scrollTop = 50;
    c.scrollToTop();
    expect(c.el.scrollTop).toBe(0);
  });

  test('scrollToNode exists and does not throw on a child node', () => {
    const c = ChatContainer();
    const node = document.createElement('div');
    c.el.appendChild(node);
    expect(() => c.scrollToNode(node)).not.toThrow();
  });
});
