import { describe, expect, it } from 'vitest';
import type { Attempt, Grade } from '../domain/types.js';
import { deriveSummary } from './summary.js';

/** Build a minimal Attempt with the given grade (as `rating`) `daysAgo` days before `now`. */
function attempt(rating: Grade, daysAgo: number, now: string): Attempt {
  const createdAt = new Date(new Date(now).getTime() - daysAgo * 86_400_000).toISOString();
  return {
    id: `a-${daysAgo}-${rating}`,
    customerId: 'c',
    questionId: 'q',
    answer: 'x',
    recommendedGrade: rating,
    rating,
    issues: [],
    createdAt,
  };
}

const NOW = '2026-06-13T00:00:00.000Z';

describe('deriveSummary', () => {
  it('no attempts → new + ready, empty grades', () => {
    expect(deriveSummary([], NOW)).toEqual({ mastery: 'new', readiness: 'ready', grades: [] });
  });

  it('grades are returned oldest-first regardless of input order', () => {
    const a = [attempt('incorrect', 2, NOW), attempt('correct', 10, NOW)]; // newest-first input
    expect(deriveSummary(a, NOW).grades).toEqual(['correct', 'incorrect']);
  });

  it('all-correct recent history → excellent, and excellent is always finalized', () => {
    const a = [attempt('correct', 30, NOW), attempt('correct', 20, NOW), attempt('correct', 10, NOW)];
    const s = deriveSummary(a, NOW);
    expect(s.mastery).toEqual('excellent');
    expect(s.readiness).toEqual('finalized');
  });

  it('a recent fail history → improving, not excellent', () => {
    const a = [attempt('incorrect', 3, NOW), attempt('partial', 2, NOW), attempt('incorrect', 1, NOW)];
    expect(deriveSummary(a, NOW).mastery).toEqual('improving');
  });

  it('a non-excellent problem due now is ready; not-yet-due is waiting', () => {
    // One correct attempt 10 days ago: step 1 ⇒ 7-day interval ⇒ due 3 days ago ⇒ ready.
    const due = deriveSummary([attempt('correct', 10, NOW)], NOW);
    expect(due.readiness).toEqual('ready');
    // One partial attempt 1 day ago: step 0 ⇒ 7-day interval ⇒ due in 6 days ⇒ waiting.
    const resting = deriveSummary([attempt('partial', 1, NOW)], NOW);
    expect(resting.readiness).toEqual('waiting');
  });
});
