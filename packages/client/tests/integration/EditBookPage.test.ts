import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { EditBookPage } from '@/pages/EditBookPage';

const mockBook = {
  id: 'b1',
  title: 'Quantum',
  author: 'Griffiths',
  isbn: '9781107179868',
  publisher: 'Cambridge University Press',
  year: 2018,
};

// The GET returns problems in DERIVED path order (server contract). EditBookPage
// loads from this, so rows must appear in this order — never the save order.
let questions = [
  { id: 'q-1.A.1', bookId: 'b1', label: '1.A.1', canonicalText: 'first' },
  { id: 'q-1.A.2', bookId: 'b1', label: '1.A.2', canonicalText: 'second' },
  { id: 'q-2.1', bookId: 'b1', label: '2.1', canonicalText: 'third' },
];

type FetchMock = ReturnType<typeof vi.fn>;

function install(): FetchMock {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    let body: unknown = {};
    if (url === '/api/books/b1' && method === 'PATCH') body = mockBook; // PATCH echo (unused by assertions)
    else if (url === '/api/books/b1') body = mockBook;
    else if (url === '/api/books/b1/questions' && method === 'GET') body = questions;
    else if (url === '/api/books/b1/questions' && method === 'PUT') body = questions; // PUT echo (unused by assertions)
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Pull the JSON body of the first PATCH /api/books/:id call recorded by the mock. */
function patchBookBody(fetchMock: FetchMock): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(
    ([url, init]) => url === '/api/books/b1' && (init as RequestInit | undefined)?.method === 'PATCH',
  );
  if (!call) throw new Error('no PATCH /api/books/b1 call was made');
  return JSON.parse((call[1] as RequestInit).body as string);
}

function labelsInDom(): string[] {
  return [...document.querySelectorAll('.pr-label')].map((el) => (el as HTMLInputElement).value);
}

describe('EditBookPage', () => {
  let fetchMock: FetchMock;
  beforeEach(() => {
    window.location.hash = '#/edit-book?id=b1';
    document.body.innerHTML = '<div id="app"></div>';
    sessionStorage.clear();
    questions = [
      { id: 'q-1.A.1', bookId: 'b1', label: '1.A.1', canonicalText: 'first' },
      { id: 'q-1.A.2', bookId: 'b1', label: '1.A.2', canonicalText: 'second' },
      { id: 'q-2.1', bookId: 'b1', label: '2.1', canonicalText: 'third' },
    ];
    fetchMock = install();
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

  test('prefills publisher and year from the loaded book', async () => {
    document.getElementById('app')!.appendChild(EditBookPage());
    await vi.waitFor(() => expect(document.querySelectorAll('.pr-row').length).toBe(3));

    const publisher = document.querySelector<HTMLInputElement>('input[placeholder="Publisher"]')!;
    const year = document.querySelector<HTMLInputElement>('input[placeholder="Year"]')!;
    expect(publisher.value).toBe('Cambridge University Press');
    expect(year.value).toBe('2018'); // number coerced to string for the input
  });

  test('Save sends publisher (string) and year (number) in the PATCH body', async () => {
    document.getElementById('app')!.appendChild(EditBookPage());
    await vi.waitFor(() => expect(document.querySelectorAll('.pr-row').length).toBe(3));

    const publisher = document.querySelector<HTMLInputElement>('input[placeholder="Publisher"]')!;
    const year = document.querySelector<HTMLInputElement>('input[placeholder="Year"]')!;
    publisher.value = 'MIT Press';
    year.value = '2021';

    document.querySelector<HTMLButtonElement>('.primary-btn')!.click();
    await vi.waitFor(() => patchBookBody(fetchMock)); // wait until the PATCH fires

    const body = patchBookBody(fetchMock);
    expect(body.publisher).toBe('MIT Press');
    expect(body.year).toBe(2021); // sent as a number, matching the server's typeof guard
  });

  test('Save omits year (rather than sending NaN) when the field is blank', async () => {
    document.getElementById('app')!.appendChild(EditBookPage());
    await vi.waitFor(() => expect(document.querySelectorAll('.pr-row').length).toBe(3));

    document.querySelector<HTMLInputElement>('input[placeholder="Year"]')!.value = '';
    document.querySelector<HTMLButtonElement>('.primary-btn')!.click();
    await vi.waitFor(() => patchBookBody(fetchMock));

    expect(patchBookBody(fetchMock)).not.toHaveProperty('year'); // never send NaN
  });
});
