import { describe, expect, it } from 'vitest';
import type { Attempt, Book, Grade, Question } from '../domain/types.js';
import { summarizeBooks } from './book-summaries.js';

const NOW = '2026-06-15T00:00:00.000Z';
const daysAgoIso = (n: number): string => new Date(new Date(NOW).getTime() - n * 86_400_000).toISOString();

const book = (id: string, questionIds: string[]): Book => ({
  id, customerId: 'c', title: id, questionIds, createdAt: daysAgoIso(40),
});
const q = (id: string, bookId: string, label: string): Question => ({
  id, customerId: 'c', bookId, label, canonicalText: label, source: { kind: 'text' }, createdAt: daysAgoIso(40),
});
const attempt = (questionId: string, rating: Grade, daysAgo: number): Attempt => ({
  id: `a-${questionId}-${daysAgo}`, customerId: 'c', questionId,
  answer: 'x', recommendedGrade: rating, rating, issues: [], createdAt: daysAgoIso(daysAgo),
});

describe('summarizeBooks', () => {
  it('progress is the mastery-weighted mean × 100, rounded; 0 for an empty book', () => {
    const b = book('b', ['q1', 'q2']);
    const qs = [q('q1', 'b', '1'), q('q2', 'b', '2')];
    // q1: no attempts → 'new' (0). q2: one correct 1 day ago → 'strong' (0.66):
    // deriveSummary scores a lone 'correct' at 1.0 (≥0.6 → strong; excellent needs ≥3 attempts).
    const attempts = [attempt('q2', 'correct', 1)];
    const [s] = summarizeBooks([b], qs, attempts, new Set(), NOW);
    expect(s!.summary.progress).toBe(33); // round((0 + 0.66)/2 * 100) = 33

    const [empty] = summarizeBooks([book('e', [])], [], [], new Set(), NOW);
    expect(empty!.summary.progress).toBe(0); // guarded, never NaN
  });

  it('dueNow counts ready problems and excludes actively-skipped ones', () => {
    const b = book('b', ['q1', 'q2']);
    const qs = [q('q1', 'b', '1'), q('q2', 'b', '2')];
    // Both due: one correct 10 days ago → step 1 → due 3 days ago → ready.
    const attempts = [attempt('q1', 'correct', 10), attempt('q2', 'correct', 10)];
    const open = summarizeBooks([b], qs, attempts, new Set(), NOW);
    expect(open[0]!.summary.dueNow).toBe(2);
    const skipped = summarizeBooks([b], qs, attempts, new Set(['q2']), NOW);
    expect(skipped[0]!.summary.dueNow).toBe(1);
  });

  it('dueNow excludes never-attempted problems (they are learn material, not revisit)', () => {
    const b = book('b', ['q1', 'q2']);
    const qs = [q('q1', 'b', '1'), q('q2', 'b', '2')];
    // q1 attempted-and-due (ready); q2 never attempted (also 'ready', but not revisit).
    const attempts = [attempt('q1', 'correct', 10)];
    const [s] = summarizeBooks([b], qs, attempts, new Set(), NOW);
    expect(s!.summary.dueNow).toBe(1); // only q1 — q2 is new, excluded
  });

  it('nextReviewDate is the earliest among waiting problems; null when none waiting', () => {
    const b = book('b', ['q1', 'q2']);
    const qs = [q('q1', 'b', '1'), q('q2', 'b', '2')];
    // partial 1 day ago → step 0 → due in 6 days (waiting). Two of them: earliest wins.
    const attempts = [attempt('q1', 'partial', 1), attempt('q2', 'partial', 3)];
    const [s] = summarizeBooks([b], qs, attempts, new Set(), NOW);
    expect(s!.summary.nextReviewDate).not.toBeNull();
    // q1 reviewed 1 day ago → due NOW+6d; q2 reviewed 3 days ago → due NOW+4d (earlier).
    expect(s!.summary.nextReviewDate).toBe(new Date(new Date(NOW).getTime() + 4 * 86_400_000).toISOString());

    const none = summarizeBooks([book('n', ['q3'])], [q('q3', 'n', '1')], [], new Set(), NOW);
    expect(none[0]!.summary.nextReviewDate).toBeNull();
  });

  it('learnNext is the first un-attempted problem in derived path order, with its path prefix', () => {
    const b = book('b', ['q1', 'q2', 'q3']);
    // Out of path order in storage; q2 (1.A.2) is attempted, so learnNext skips it.
    const qs = [q('q1', 'b', '2.1'), q('q2', 'b', '1.A.2'), q('q3', 'b', '1.A.10')];
    const attempts = [attempt('q2', 'correct', 1)];
    const [s] = summarizeBooks([b], qs, attempts, new Set(), NOW);
    // Path order: 1.A.2 (attempted, skip) → 1.A.10 → 2.1. First un-attempted = 1.A.10.
    expect(s!.summary.learnNext).toEqual({ label: '1.A.10', pathPrefix: '1' });
  });

  it('learnNext is null when every problem has an attempt', () => {
    const b = book('b', ['q1']);
    const qs = [q('q1', 'b', '1')];
    const [s] = summarizeBooks([b], qs, [attempt('q1', 'correct', 1)], new Set(), NOW);
    expect(s!.summary.learnNext).toBeNull();
  });
});
