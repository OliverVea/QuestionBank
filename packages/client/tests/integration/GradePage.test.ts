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

  test('typing an answer grades it and reveals the grade-row', async () => {
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

  test('editing an earlier answer truncates downstream turns and regrades', async () => {
    setHash('#/grade?questionId=q1&mode=type&from=learn');
    const page = GradePage();
    document.body.appendChild(page);
    await flush();

    // First answer → grade
    const input = page.querySelector('.reply-input') as HTMLTextAreaElement;
    input.value = 'first answer';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush(); await flush();
    // Clarify → second grade
    input.value = 'a clarification';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush(); await flush();
    expect(page.querySelectorAll('.chat-bubble-user')).toHaveLength(2);

    // Edit the FIRST user bubble
    const firstEdit = page.querySelector('.chat-bubble-user .bubble-edit') as HTMLButtonElement;
    firstEdit.click();
    await flush();
    const editor = page.querySelector('textarea.bubble-editor') as HTMLTextAreaElement;
    editor.value = 'edited first answer';
    (page.querySelector('.bubble-save') as HTMLButtonElement).click();
    await flush();

    // Downstream gone (one user turn), regrade in flight then lands
    expect(page.querySelectorAll('.chat-bubble-user')).toHaveLength(1);
    expect(page.querySelector('.chat-bubble-user')?.textContent).toContain('edited first answer');
    await flush(); await flush();
    expect(page.querySelector('.chat-bubble-agent .grade-badge')).not.toBeNull();
    page.remove();
  });

  test('sending Enter twice while grade is in flight produces only one user bubble and one grade badge', async () => {
    setHash('#/grade?questionId=q1&mode=type&from=learn');
    const page = GradePage();
    document.body.appendChild(page);
    await flush();

    const input = page.querySelector('.reply-input') as HTMLTextAreaElement;
    // Fire Enter twice synchronously before any microtask flush
    input.value = 'my answer';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    // Now flush so the grade API resolves
    await flush(); await flush();

    expect(page.querySelectorAll('.chat-bubble-user')).toHaveLength(1);
    expect(page.querySelectorAll('.grade-badge')).toHaveLength(1);
    page.remove();
  });

  test('photo flow: read → correct → re-read → confirm → grade', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/transcribe')) return { ok: true, status: 200, json: async () => ({ transcription: 'reading 1' }) };
      if (url.endsWith('/transcribe/retry')) return { ok: true, status: 200, json: async () => ({ transcription: 'reading 2' }) };
      if (url.endsWith('/grade')) return { ok: true, status: 200, json: async () => ({ reasoning: 'r', issues: [], recommendedGrade: 'correct' }) };
      if (url.includes('/books/')) return { ok: true, status: 200, json: async () => ({ title: 'Griffiths' }) };
      if (url.includes('/questions/')) return { ok: true, status: 200, json: async () => ({ canonicalText: 'Q', label: 'Griffiths · Ch 2 · P1', bookId: 'b1' }) };
      return { ok: true, status: 200, json: async () => ({}) };
    }));
    const { stashPhotos } = await import('@/lib/photo-transfer');
    stashPhotos({ files: [new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })], notes: '' });

    setHash('#/grade?questionId=q1&mode=photo&from=learn');
    const page = GradePage();
    document.body.appendChild(page);
    await flush(); await flush();

    expect(page.querySelector('.phase-bar')?.hasAttribute('hidden')).toBe(false);
    expect(page.querySelector('.reading-bubble')?.textContent).toContain('reading 1');
    expect(page.querySelector('.advance-btn')?.hasAttribute('hidden')).toBe(false);

    const input = page.querySelector('.reply-input') as HTMLTextAreaElement;
    input.value = 'that 7 is a 1';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush(); await flush();
    expect(page.querySelectorAll('.reading-bubble')).toHaveLength(2);

    (page.querySelector('.advance-btn') as HTMLButtonElement).click();
    await flush(); await flush();
    expect(page.querySelector('.reading-bubble')).toBeNull();
    expect(page.querySelectorAll('.chat-bubble-user')).toHaveLength(1);
    expect(page.querySelector('.chat-bubble-agent .grade-badge')?.textContent).toBe('correct');
    page.remove();
  });
});
