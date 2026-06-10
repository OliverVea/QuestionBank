import { describe, expect, it } from 'vitest';
import type { Attempt, Grade } from '@/domain/types.js';
import { scheduleFor } from '@/services/srs.js';

/** Build a minimal Attempt with a given rating and createdAt; other fields are irrelevant to the scheduler. */
function attempt(rating: Grade, createdAt: string): Attempt {
  return {
    id: createdAt,
    customerId: 'local',
    questionId: 'q',
    answer: '',
    recommendedGrade: rating,
    rating,
    issues: [],
    createdAt,
  };
}

const NOW = '2026-06-07T00:00:00.000Z';

describe('scheduleFor — pure SRS ladder derived from attempt history', () => {
  it('returns null when the question has no attempts (not in the ladder)', () => {
    expect(scheduleFor([], NOW)).toBeNull();
  });

  it('one correct attempt -> step 1, due +7 days', () => {
    const s = scheduleFor([attempt('correct', '2026-06-01T00:00:00.000Z')], NOW)!;
    expect(s.step).toBe(1);
    expect(s.lastReviewedAt).toBe('2026-06-01T00:00:00.000Z');
    expect(s.nextReviewDate).toBe('2026-06-08T00:00:00.000Z');
  });

  it('two correct attempts -> step 2, due +30 days', () => {
    const s = scheduleFor(
      [attempt('correct', '2026-06-01T00:00:00.000Z'), attempt('correct', '2026-06-02T00:00:00.000Z')],
      NOW,
    )!;
    expect(s.step).toBe(2);
    expect(s.nextReviewDate).toBe('2026-07-02T00:00:00.000Z');
  });

  it('three correct attempts -> step caps at 2', () => {
    const s = scheduleFor(
      [
        attempt('correct', '2026-06-01T00:00:00.000Z'),
        attempt('correct', '2026-06-02T00:00:00.000Z'),
        attempt('correct', '2026-06-03T00:00:00.000Z'),
      ],
      NOW,
    )!;
    expect(s.step).toBe(2);
    expect(s.nextReviewDate).toBe('2026-07-03T00:00:00.000Z');
  });

  it('a single incorrect attempt -> step 0, due +7 days', () => {
    const s = scheduleFor([attempt('incorrect', '2026-06-01T00:00:00.000Z')], NOW)!;
    expect(s.step).toBe(0);
    expect(s.nextReviewDate).toBe('2026-06-08T00:00:00.000Z');
  });

  it('a non-correct attempt HOLDS the step (does not reset)', () => {
    const s = scheduleFor(
      [attempt('correct', '2026-06-01T00:00:00.000Z'), attempt('incorrect', '2026-06-02T00:00:00.000Z')],
      NOW,
    )!;
    expect(s.step).toBe(1);
    expect(s.nextReviewDate).toBe('2026-06-09T00:00:00.000Z'); // last reviewed 06-02 + 7d
  });

  it('partial counts as a non-advance hold at step 2', () => {
    const s = scheduleFor(
      [
        attempt('correct', '2026-06-01T00:00:00.000Z'),
        attempt('correct', '2026-06-02T00:00:00.000Z'),
        attempt('partial', '2026-06-03T00:00:00.000Z'),
      ],
      NOW,
    )!;
    expect(s.step).toBe(2);
    expect(s.nextReviewDate).toBe('2026-07-03T00:00:00.000Z'); // 06-03 + 30d
  });

  it('replays in chronological order regardless of input order', () => {
    const later = attempt('correct', '2026-06-02T00:00:00.000Z');
    const earlier = attempt('correct', '2026-06-01T00:00:00.000Z');
    const s = scheduleFor([later, earlier], NOW)!;
    expect(s.step).toBe(2);
    expect(s.lastReviewedAt).toBe('2026-06-02T00:00:00.000Z');
  });
});
