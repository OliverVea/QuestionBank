import { describe, expect, it } from 'vitest';
import type { Attempt, Book, Question, Relevance, Skip } from '../domain/types.js';
import type { Store } from '../storage/store.js';
import { suggestNext } from './learn-next.js';

const NOW = '2026-06-15T00:00:00.000Z';

const book = (id: string, questionIds: string[]): Book => ({
  id, customerId: 'c', title: id, questionIds, createdAt: NOW,
});
const q = (id: string, bookId: string, label: string, relevance?: Relevance): Question => ({
  id, customerId: 'c', bookId, label, canonicalText: label,
  source: { kind: 'text' }, createdAt: NOW, ...(relevance ? { relevance } : {}),
});
const attempt = (questionId: string): Attempt => ({
  id: `a-${questionId}`, customerId: 'c', questionId,
  answer: 'x', recommendedGrade: 'correct', rating: 'correct', issues: [], createdAt: NOW,
});

/** A fake Store backed by in-memory arrays; suggestNext only calls `.getAll`. */
function fakeStore(books: Book[], questions: Question[], attempts: Attempt[], skips: Skip[] = []): Store {
  const repo = <T>(rows: T[]) => ({ getAll: async () => rows }) as never;
  return { books: repo(books), questions: repo(questions), attempts: repo(attempts), skips: repo(skips) } as Store;
}

describe('suggestNext — relevance-aware next-to-learn', () => {
  it('within a book, a high-relevance question outranks a lower one earlier in path order', async () => {
    const store = fakeStore(
      [book('b', ['q1', 'q2'])],
      [q('q1', 'b', '1', 'low'), q('q2', 'b', '2', 'high')],
      [],
    );
    const next = await suggestNext(store, 'c', NOW);
    expect(next?.question.id).toBe('q2'); // high beats low despite q1's earlier path
  });

  it('postpones low until higher-relevance questions in the book are all attempted', async () => {
    const store = fakeStore(
      [book('b', ['q1', 'q2'])],
      [q('q1', 'b', '1', 'low'), q('q2', 'b', '2', 'high')],
      [attempt('q2')], // the high one is done
    );
    const next = await suggestNext(store, 'c', NOW);
    expect(next?.question.id).toBe('q1'); // only low remains → surfaces now
  });

  it('within the same relevance band, falls back to derived path order', async () => {
    const store = fakeStore(
      [book('b', ['q1', 'q2'])],
      [q('q1', 'b', '2', 'high'), q('q2', 'b', '1', 'high')],
      [],
    );
    const next = await suggestNext(store, 'c', NOW);
    expect(next?.question.id).toBe('q2'); // path 1 before path 2
  });

  it('treats a missing relevance as medium (between high and low)', async () => {
    const store = fakeStore(
      [book('b', ['q1', 'q2', 'q3'])],
      [q('q1', 'b', '1', 'low'), q('q2', 'b', '2'), q('q3', 'b', '3', 'high')],
      [],
    );
    const order: string[] = [];
    let s = store;
    // Walk the queue by attempting whatever is suggested, three times.
    const attempts: Attempt[] = [];
    for (let i = 0; i < 3; i++) {
      const next = await suggestNext(s, 'c', NOW);
      if (!next) break;
      order.push(next.question.id);
      attempts.push(attempt(next.question.id));
      s = fakeStore(
        [book('b', ['q1', 'q2', 'q3'])],
        [q('q1', 'b', '1', 'low'), q('q2', 'b', '2'), q('q3', 'b', '3', 'high')],
        [...attempts],
      );
    }
    expect(order).toEqual(['q3', 'q2', 'q1']); // high, then untagged (medium), then low
  });

  it('defers low book-wide, not per-chapter: a ch.1 low waits behind a ch.2 high', async () => {
    const store = fakeStore(
      [book('b', ['q1', 'q2'])],
      [q('q1', 'b', '1.A.1', 'low'), q('q2', 'b', '2.A.1', 'high')],
      [],
    );
    const next = await suggestNext(store, 'c', NOW);
    // If deferral were per-chapter, ch.1's low (q1) would surface before ch.2 (q2).
    // It is book-wide, so the ch.2 high wins.
    expect(next?.question.id).toBe('q2');
  });

  it('scans books in list order; relevance does not reorder across books', async () => {
    const store = fakeStore(
      [book('b1', ['q1']), book('b2', ['q2'])],
      [q('q1', 'b1', '1', 'low'), q('q2', 'b2', '1', 'high')],
      [],
    );
    const next = await suggestNext(store, 'c', NOW);
    expect(next?.question.id).toBe('q1'); // first book wins even though its only question is low
  });
});
