import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { LandingPage } from '@/pages/LandingPage';
import type { Activity, BookWithSummary } from '@/lib/types';

const activity: Activity = {
  streak: 5, daysActive: 3, problemsThisWeek: 12, daysGoal: 3, problemsGoal: 20,
};

const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
const books: BookWithSummary[] = [
  { id: 'b1', customerId: 'local', title: 'Quantum', author: 'Griffiths', isbn: '9781107179868',
    questionIds: [], createdAt: '2026-01-01T00:00:00Z',
    summary: { progress: 42, dueNow: 7, nextReviewDate: null, learnNext: { label: '3.1', pathPrefix: '3' } } },
  { id: 'b2', customerId: 'local', title: 'Calculus', questionIds: [], createdAt: '2026-01-01T00:00:00Z',
    summary: { progress: 68, dueNow: 0, nextReviewDate: future, learnNext: { label: '5.B.1', pathPrefix: '5' } } },
  { id: 'b3', customerId: 'local', title: 'Done Book', questionIds: [], createdAt: '2026-01-01T00:00:00Z',
    summary: { progress: 100, dueNow: 0, nextReviewDate: null, learnNext: null } },
];

function mockFetch(url: string): Promise<Response> {
  const body = url === '/api/activity' ? activity : books;
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
}

describe('LandingPage', () => {
  beforeEach(() => {
    window.location.hash = '#/';
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal('fetch', vi.fn(mockFetch));
  });
  afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

  test('renders the activity header with streak and goal metrics', async () => {
    document.getElementById('app')!.appendChild(LandingPage());
    await vi.waitFor(() => expect(document.querySelector('.activity')).not.toBeNull());
    expect(document.querySelector('#stat-streak')!.textContent).toContain('5');
    const days = document.querySelector('#stat-days')!;
    expect(days.textContent).toContain('3');
    expect(days.classList.contains('complete')).toBe(true); // 3 >= 3
    expect(document.querySelector('#stat-problems')!.classList.contains('complete')).toBe(false); // 12 < 20
  });

  test('renders one card per book with progress and pills', async () => {
    document.getElementById('app')!.appendChild(LandingPage());
    await vi.waitFor(() => expect(document.querySelectorAll('.book-card').length).toBe(3));

    const cardFor = (title: string): HTMLElement =>
      [...document.querySelectorAll('.book-card')].find(
        (c) => c.querySelector('.b-title2')!.textContent === title,
      ) as HTMLElement;

    // Book 1: due now → "7 to revisit" tappable pill + learn pill.
    const c1 = cardFor('Quantum');
    expect(c1.querySelector('.bc-pct')!.textContent).toBe('42%');
    expect(c1.querySelector('.bc-revisit')!.textContent).toContain('7 to revisit');
    expect(c1.querySelector('.bc-learn')!.textContent).toContain('Start learning 3');

    // Book 2: nothing due but scheduled → quiet "Ready in N days" pill.
    const c2 = cardFor('Calculus');
    expect(c2.querySelector('.bc-revisit-soon')!.textContent).toMatch(/Ready in \d+ days?/);
    expect(c2.querySelector('.bc-revisit')).toBeNull();
  });

  test('finished book sinks to the bottom and shows no pills', async () => {
    document.getElementById('app')!.appendChild(LandingPage());
    await vi.waitFor(() => expect(document.querySelectorAll('.book-card').length).toBe(3));
    const cards = [...document.querySelectorAll('.book-card')];
    const last = cards[cards.length - 1]!;
    expect(last.querySelector('.b-title2')!.textContent).toBe('Done Book');
    expect(last.classList.contains('finished')).toBe(true);
    expect(last.querySelector('.bc-actions')).toBeNull();
  });

  test('revisit pill navigates without triggering the card head', async () => {
    document.getElementById('app')!.appendChild(LandingPage());
    await vi.waitFor(() => expect(document.querySelector('.bc-revisit')).not.toBeNull());
    (document.querySelector('.bc-revisit') as HTMLButtonElement).click();
    expect(window.location.hash).toBe('#/revisit');
  });
});
