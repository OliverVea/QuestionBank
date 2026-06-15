import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { EditBookPage } from '@/pages/EditBookPage';

const mockBook = { id: 'b1', title: 'Quantum', author: 'Griffiths', isbn: '9781107179868' };

// The GET returns problems in DERIVED path order (server contract). EditBookPage
// loads from this, so rows must appear in this order — never the save order.
let questions = [
  { id: 'q-1.A.1', bookId: 'b1', label: '1.A.1', canonicalText: 'first' },
  { id: 'q-1.A.2', bookId: 'b1', label: '1.A.2', canonicalText: 'second' },
  { id: 'q-2.1', bookId: 'b1', label: '2.1', canonicalText: 'third' },
];

function install(): void {
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    let body: unknown = {};
    if (url === '/api/books/b1') body = mockBook;
    else if (url === '/api/books/b1/questions' && method === 'GET') body = questions;
    else if (url === '/api/books/b1/questions' && method === 'PUT') body = questions; // PUT echo (unused by assertions)
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
  }));
}

function labelsInDom(): string[] {
  return [...document.querySelectorAll('.pr-label')].map((el) => (el as HTMLInputElement).value);
}

describe('EditBookPage', () => {
  beforeEach(() => {
    window.location.hash = '#/edit-book?id=b1';
    document.body.innerHTML = '<div id="app"></div>';
    sessionStorage.clear();
    questions = [
      { id: 'q-1.A.1', bookId: 'b1', label: '1.A.1', canonicalText: 'first' },
      { id: 'q-1.A.2', bookId: 'b1', label: '1.A.2', canonicalText: 'second' },
      { id: 'q-2.1', bookId: 'b1', label: '2.1', canonicalText: 'third' },
    ];
    install();
  });
  afterEach(() => {
    // Detach the page so its beforeunload-cleanup MutationObserver (which reads
    // `document`) disconnects before jsdom tears the document down between tests.
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  test('renders rows with no drag handle (reorder removed)', async () => {
    document.getElementById('app')!.appendChild(EditBookPage());
    await vi.waitFor(() => expect(document.querySelector('.pr-row')).not.toBeNull());
    expect(document.querySelector('.pr-handle')).toBeNull();
  });

  test('loads rows in the GET (derived path) order', async () => {
    document.getElementById('app')!.appendChild(EditBookPage());
    await vi.waitFor(() => expect(document.querySelectorAll('.pr-row').length).toBe(3));
    expect(labelsInDom()).toEqual(['1.A.1', '1.A.2', '2.1']);
  });

  test('scan-merge resync repopulates rows in derived path order, not append order', async () => {
    // A scanned problem with an out-of-order path (1.B.1 — belongs between 1.A.2 and 2.1).
    sessionStorage.setItem('qb-scan-accepted', JSON.stringify([
      { label: '1.B.1', latex: 'scanned middle' },
    ]));
    // The server stores it and the GET re-fetch returns the full set in path order.
    questions = [
      ...questions.slice(0, 2),
      { id: 'q-1.B.1', bookId: 'b1', label: '1.B.1', canonicalText: 'scanned middle' },
      questions[2]!,
    ];

    document.getElementById('app')!.appendChild(EditBookPage());

    // After load + scan-merge + PUT + GET-refetch, the scanned row lands in path
    // position (between 1.A.2 and 2.1) — proving the refetch uses derived order,
    // not the PUT/insertion order that would push it to the end.
    await vi.waitFor(() => expect(labelsInDom()).toEqual(['1.A.1', '1.A.2', '1.B.1', '2.1']));
  });
});
