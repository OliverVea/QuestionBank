import { describe, test, expect, beforeEach, vi } from 'vitest';
import { LandingPage } from '@/pages/LandingPage';

const mockBooks = [
  {
    id: '1',
    title: 'Introduction to Quantum Mechanics',
    author: 'David J. Griffiths',
    questionIds: ['q1', 'q2', 'q3'],
    isbn: '9781107179868',
    customerId: 'local',
    createdAt: '2024-01-01T00:00:00Z',
  },
];

const mockDue = { count: 5 };
const mockLearnNext = {
  question: { id: 'q1', bookId: '1' },
  book: { id: '1', title: 'Introduction to Quantum Mechanics', questionIds: ['q1', 'q2', 'q3'] },
};

function mockFetch(url: string): Promise<Response> {
  let body: unknown;
  if (url === '/api/books') body = mockBooks;
  else if (url === '/api/practice/due?count=true') body = mockDue;
  else if (url === '/api/learn/next') body = mockLearnNext;
  else body = {};

  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}

describe('LandingPage', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal('fetch', vi.fn(mockFetch));
  });

  test('renders banners and populates book rows after data loads', async () => {
    const page = LandingPage();
    document.getElementById('app')!.appendChild(page);

    // Wait for async data to populate.
    await vi.waitFor(() => {
      expect(document.querySelector('.book')).not.toBeNull();
    });

    // Revisit banner should show count (replaced from empty state).
    const revisit = document.querySelector('.banner.revisit');
    expect(revisit).not.toBeNull();
    expect(revisit!.textContent).toContain('5');
    expect(revisit!.textContent).toContain('problems waiting');
    expect(revisit!.classList.contains('empty')).toBe(false);

    // Learn banner should show book title.
    const learn = document.querySelector('.banner.learn');
    expect(learn).not.toBeNull();
    expect(learn!.textContent).toContain('Quantum Mechanics');
    expect(learn!.classList.contains('empty')).toBe(false);

    // Book row should appear with title and question count.
    const bookRow = document.querySelector('.book');
    expect(bookRow).not.toBeNull();
    expect(bookRow!.textContent).toContain('Introduction to Quantum Mechanics');
    expect(bookRow!.textContent).toContain('3 questions');
  });

  test('renders empty-state banners when no data', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/books') return Promise.resolve(new Response('[]'));
      if (url === '/api/practice/due?count=true') return Promise.resolve(new Response(JSON.stringify({ count: 0 })));
      if (url === '/api/learn/next') return Promise.resolve(new Response(JSON.stringify({ question: null })));
      return Promise.resolve(new Response('{}'));
    }));

    const page = LandingPage();
    document.getElementById('app')!.appendChild(page);

    // Wait a tick for the async load to complete.
    await new Promise(r => setTimeout(r, 10));

    // Banners should remain in empty state.
    const revisit = document.querySelector('.banner.revisit');
    expect(revisit).not.toBeNull();
    expect(revisit!.classList.contains('empty')).toBe(true);
    expect(revisit!.textContent).toContain('All caught up');

    const learn = document.querySelector('.banner.learn');
    expect(learn).not.toBeNull();
    expect(learn!.classList.contains('empty')).toBe(true);
    expect(learn!.textContent).toContain('Nothing new');

    // No book rows should appear.
    expect(document.querySelector('.book')).toBeNull();
  });
});
