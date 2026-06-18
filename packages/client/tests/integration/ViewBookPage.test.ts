import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ViewBookPage } from '@/pages/ViewBookPage';
import type { QuestionWithSummary } from '@/lib/types';

const mockBook = {
  id: 'b1',
  title: 'Introduction to Quantum Mechanics',
  author: 'David J. Griffiths',
  isbn: '9781107179868',
  publisher: 'Cambridge University Press',
  year: 2018,
};

// Already in DERIVED path order (the server sorts; the page only groups).
const future = new Date(Date.now() + 6 * 86_400_000).toISOString();
const mockQuestions: QuestionWithSummary[] = [
  { id: 'q-1.5', bookId: 'b1', label: '1.5', canonicalText: 'Loose chapter-1 problem', relevance: 'high',
    summary: { mastery: 'strong', readiness: 'ready', grades: ['correct'] } },
  { id: 'q-1.A.1', bookId: 'b1', label: '1.A.1', canonicalText: 'Normalize $\\Psi$', relevance: 'low',
    summary: { mastery: 'improving', readiness: 'waiting', grades: ['incorrect', 'partial'], nextReviewDate: future } },
  { id: 'q-1.A.2', bookId: 'b1', label: '1.A.2', canonicalText: 'Show $d\\langle x\\rangle/dt$',
    summary: { mastery: 'strong', readiness: 'waiting', grades: ['correct'], nextReviewDate: future } },
  { id: 'q-1.B.1', bookId: 'b1', label: '1.B.1', canonicalText: 'Infinite square well',
    summary: { mastery: 'excellent', readiness: 'finalized', grades: ['correct', 'correct', 'correct'] } },
  { id: 'q-2.3', bookId: 'b1', label: '2.3', canonicalText: 'Step potential',
    summary: { mastery: 'improving', readiness: 'waiting', grades: ['partial'], nextReviewDate: future } },
  { id: 'q-x', bookId: 'b1', label: '', canonicalText: 'Unlabelled problem',
    summary: { mastery: 'new', readiness: 'ready', grades: [] } },
];

function mockFetch(url: string): Promise<Response> {
  const body = url.endsWith('/questions') ? mockQuestions : mockBook;
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
}

describe('ViewBookPage', () => {
  beforeEach(() => {
    window.location.hash = '#/view-book?id=b1';
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal('fetch', vi.fn(mockFetch));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  test('groups problems two levels by path, preserving derived order', async () => {
    document.getElementById('app')!.appendChild(ViewBookPage());
    await vi.waitFor(() => expect(document.querySelector('.vb-group')).not.toBeNull());

    // Chapter headers in order: 1, 2, then Ungrouped.
    const chapterHeads = [...document.querySelectorAll('.vb-group > .vb-group-head')];
    const chapterNames = chapterHeads.map((h) => h.querySelector('.vb-crumb')!.textContent!.trim());
    expect(chapterNames).toEqual(['1', '2', 'Ungrouped']);

    // Chapter 1 has a direct problem (1.5) before its subsections (A, B).
    const c1 = document.querySelectorAll('.vb-group')[0]!;
    const c1Labels = [...c1.querySelectorAll('.vb-label')].map((l) => l.textContent);
    expect(c1Labels).toEqual(['1.5', '1.A.1', '1.A.2', '1.B.1']);

    // Subsection headers exist (chapter ▸ section breadcrumbs).
    // Breadcrumb segments are separate spans (visual gap is CSS); textContent
    // concatenates them with the › separator and no spaces.
    const subHeads = [...c1.querySelectorAll('.vb-group-head.is-sub')]
      .map((h) => h.querySelector('.vb-crumb')!.textContent!.trim());
    expect(subHeads).toEqual(['1›A', '1›B']);
  });

  test('renders mastery pill + readiness column per state', async () => {
    document.getElementById('app')!.appendChild(ViewBookPage());
    await vi.waitFor(() => expect(document.querySelector('.vb-row')).not.toBeNull());

    const rowFor = (label: string): HTMLElement =>
      [...document.querySelectorAll('.vb-row')].find(
        (r) => r.querySelector('.vb-label')!.textContent === label,
      ) as HTMLElement;

    // Mastery pill carries the word + est-* tint class.
    expect(rowFor('1.B.1').querySelector('.mastery-pill')!.textContent).toBe('Excellent');
    expect(rowFor('1.B.1').querySelector('.mastery-pill')!.classList.contains('est-excellent')).toBe(true);

    // Readiness column: ready / waiting / finalized.
    expect(rowFor('1.5').querySelector('.vb-ready')!.textContent).toBe('Ready now');
    expect(rowFor('1.A.1').querySelector('.vb-ready')!.textContent).toMatch(/^Ready in \d+ days?$/);
    expect(rowFor('1.B.1').querySelector('.vb-ready')!.textContent).toBe(''); // finalized → empty
  });

  test('renders a relevance badge only when the question has relevance set', async () => {
    document.getElementById('app')!.appendChild(ViewBookPage());
    await vi.waitFor(() => expect(document.querySelector('.vb-row')).not.toBeNull());

    const rowFor = (label: string): HTMLElement =>
      [...document.querySelectorAll('.vb-row')].find(
        (r) => r.querySelector('.vb-label')!.textContent === label,
      ) as HTMLElement;

    // Badge carries the word + rel-* tint class when relevance is set.
    const high = rowFor('1.5').querySelector('.relevance-badge')!;
    expect(high.textContent).toBe('High');
    expect(high.classList.contains('rel-high')).toBe(true);
    expect(rowFor('1.A.1').querySelector('.relevance-badge')!.classList.contains('rel-low')).toBe(true);

    // No relevance → no badge.
    expect(rowFor('1.B.1').querySelector('.relevance-badge')).toBeNull();
  });

  test('group headers toggle collapse, independently of subsections', async () => {
    document.getElementById('app')!.appendChild(ViewBookPage());
    await vi.waitFor(() => expect(document.querySelector('.vb-group')).not.toBeNull());

    const c1 = document.querySelectorAll('.vb-group')[0] as HTMLElement;
    const head = c1.querySelector(':scope > .vb-group-head') as HTMLElement;
    expect(c1.classList.contains('collapsed')).toBe(false);
    head.click();
    expect(c1.classList.contains('collapsed')).toBe(true);
    expect(head.getAttribute('aria-expanded')).toBe('false');

    // A subsection collapses on its own without affecting the chapter.
    head.click(); // re-expand chapter
    const sub = c1.querySelector('.vb-subgroup') as HTMLElement;
    (sub.querySelector(':scope > .vb-group-head') as HTMLElement).click();
    expect(sub.classList.contains('collapsed')).toBe(true);
    expect(c1.classList.contains('collapsed')).toBe(false);
  });

  test('rows link to the attempt-history subpage', async () => {
    document.getElementById('app')!.appendChild(ViewBookPage());
    await vi.waitFor(() => expect(document.querySelector('.vb-row')).not.toBeNull());
    const first = document.querySelector('.vb-row') as HTMLAnchorElement;
    expect(first.getAttribute('href')).toContain('#/attempts?questionId=');
    expect(first.getAttribute('href')).toContain('bookId=b1');
  });
});
