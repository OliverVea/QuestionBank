// packages/client/tests/integration/GradePage.test.ts
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { GradePage } from '@/pages/GradePage';

function setHash(h: string) { window.location.hash = h; }

function mockEndpoints() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/grade')) {
      return { ok: true, status: 200, json: async () => ({ reasoning: 'r', issues: [], recommendedGrade: 'correct' }) };
    }
    if (url.includes('/questions/') && !url.includes('/grade') && !url.includes('/attempts') && !url.includes('/transcribe')) {
      return { ok: true, status: 200, json: async () => ({ canonicalText: 'Q text', label: 'Griffiths · Ch 2 · P1', bookId: 'b1' }) };
    }
    if (url.includes('/books/')) return { ok: true, status: 200, json: async () => ({ title: 'Griffiths' }) };
    if (url.endsWith('/attempts')) return { ok: true, status: 201, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

beforeEach(() => { mockEndpoints(); });
afterEach(() => { vi.unstubAllGlobals(); setHash(''); });

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('GradePage (typed flow)', () => {
  test('boots into the grading phase with no phase bar', async () => {
    setHash('#/grade?questionId=q1&mode=type&from=learn');
    const page = GradePage();
    document.body.appendChild(page);
    await flush();
    expect(page.querySelector('.phase-bar')?.hasAttribute('hidden')).toBe(true);
    expect(page.querySelector('.grade-row')?.hasAttribute('hidden')).toBe(true);
    page.remove();
  });

  test.skip('typing an answer grades it and reveals the grade-row', async () => {
    setHash('#/grade?questionId=q1&mode=type&from=learn');
    const page = GradePage();
    document.body.appendChild(page);
    await flush();
    const input = page.querySelector('.reply-input') as HTMLTextAreaElement;
    input.value = 'x = 4';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush(); await flush();
    expect(page.querySelector('.chat-bubble-user')?.textContent).toContain('x = 4');
    expect(page.querySelector('.chat-bubble-agent .grade-badge')?.textContent).toBe('correct');
    expect(page.querySelector('.grade-row')?.hasAttribute('hidden')).toBe(false);
    page.remove();
  });
});
