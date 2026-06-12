/** Book metadata resolved from an external catalog. Title is the only guaranteed field. */
export interface BookMetadata {
  title: string;
  author?: string;
  publisher?: string;
  year?: number;
}

/** Function that fetches the raw catalog record for an ISBN (injected for testability). */
export type IsbnFetcher = (isbn: string) => Promise<unknown>;

/** Pull the first 4-digit run out of a free-form publish date, if any. */
function extractYear(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = value.match(/\d{4}/);
  return match ? Number(match[0]) : undefined;
}

/** Map an Open Library "books" record to BookMetadata; undefined when it has no title. */
export function parseOpenLibrary(raw: unknown): BookMetadata | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.title !== 'string' || obj.title.trim() === '') return undefined;

  const authors = Array.isArray(obj.authors) ? obj.authors : [];
  const firstAuthor = authors[0];
  const author =
    typeof firstAuthor === 'object' && firstAuthor !== null
      ? (firstAuthor as Record<string, unknown>).name
      : undefined;

  const publishers = Array.isArray(obj.publishers) ? obj.publishers : [];
  const firstPublisher = publishers[0];
  const publisher =
    typeof firstPublisher === 'object' && firstPublisher !== null
      ? (firstPublisher as Record<string, unknown>).name
      : undefined;

  const year = extractYear(obj.publish_date);

  return {
    title: obj.title,
    ...(typeof author === 'string' ? { author } : {}),
    ...(typeof publisher === 'string' ? { publisher } : {}),
    ...(year !== undefined ? { year } : {}),
  };
}

/** How long to wait on Open Library before giving up; an unreachable upstream (outage, VPN
 * routing, or a network that blocks Internet Archive) must fail fast, not hang the request. */
const OPEN_LIBRARY_TIMEOUT_MS = 5000;

/** Default fetcher: Open Library's jscmd=data endpoint, which returns one record per ISBN. */
export const openLibraryFetcher: IsbnFetcher = async (isbn: string): Promise<unknown> => {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(
    isbn,
  )}&format=json&jscmd=data`;
  const res = await fetch(url, { signal: AbortSignal.timeout(OPEN_LIBRARY_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`open library ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  return body[`ISBN:${isbn}`];
};

/** Resolve metadata for an ISBN via the given fetcher; undefined when not found. */
export async function lookupIsbn(
  isbn: string,
  fetcher: IsbnFetcher = openLibraryFetcher,
): Promise<BookMetadata | undefined> {
  const raw = await fetcher(isbn);
  return parseOpenLibrary(raw);
}
