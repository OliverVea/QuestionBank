import { describe, expect, it } from 'vitest';
import type { Attempt, Grade } from '../domain/types.js';
import { computeActivity, DAYS_GOAL, PROBLEMS_GOAL } from './activity.js';

const NOW = '2026-06-15T12:00:00.000Z';
const daysAgoIso = (n: number): string => new Date(new Date(NOW).getTime() - n * 86_400_000).toISOString();
const at = (daysAgo: number): Attempt => ({
  id: `a-${daysAgo}-${Math.floor(daysAgo * 1000)}`, customerId: 'c', questionId: 'q',
  answer: 'x', recommendedGrade: 'correct' as Grade, rating: 'correct' as Grade, issues: [], createdAt: daysAgoIso(daysAgo),
});

describe('computeActivity', () => {
  it('streak counts consecutive days ending today', () => {
    const a = [at(0), at(1), at(2), /* gap at 3 */ at(4)];
    expect(computeActivity(a, NOW).streak).toBe(3);
  });

  it('streak tolerates today not yet active (counts from yesterday)', () => {
    const a = [at(1), at(2)]; // nothing today
    expect(computeActivity(a, NOW).streak).toBe(2);
  });

  it('zero attempts → zero streak and zero week actuals', () => {
    const z = computeActivity([], NOW);
    expect(z.streak).toBe(0);
    expect(z.daysActive).toBe(0);
    expect(z.problemsThisWeek).toBe(0);
  });

  it('week window is the rolling last 7 days (day 0..6 in, day 7 out)', () => {
    const a = [at(0), at(0), at(3), at(6), at(7) /* outside */];
    const r = computeActivity(a, NOW);
    expect(r.problemsThisWeek).toBe(4); // 2 today + 1 + 1, the day-7 one excluded
    expect(r.daysActive).toBe(3);       // days 0, 3, 6
  });

  it('returns the hardcoded goal targets', () => {
    const r = computeActivity([], NOW);
    expect(r.daysGoal).toBe(DAYS_GOAL);
    expect(r.problemsGoal).toBe(PROBLEMS_GOAL);
  });
});
