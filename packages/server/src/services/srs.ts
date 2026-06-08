import type { Attempt } from '../domain/types.js';

/** The derived spaced-repetition state for one question. Never persisted — computed from attempts. */
export interface ReviewSchedule {
  /** Ladder position: 0 = new/never-advanced, 1 = 1-week, 2 = 1-month (capped). */
  step: number;
  /** ISO timestamp of the most recent attempt. */
  lastReviewedAt: string;
  /** ISO timestamp when this question becomes due again. */
  nextReviewDate: string;
}

const MAX_STEP = 2;

/** Days until the next review for a given step. Step 0 (attempted but not advanced) re-dues in a week. */
function intervalDays(step: number): number {
  if (step >= 2) return 30;
  return 7; // steps 0 and 1
}

/** Add whole days to an ISO timestamp, returning a new ISO timestamp. */
function addDays(iso: string, days: number): string {
  const ms = new Date(iso).getTime() + days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

/**
 * Derive the spaced-repetition schedule for ONE question from its attempts.
 *
 * Pure and total: history is the source of truth; this is the only place the SRS
 * algorithm lives, so it can be replaced later (TODO 6e) with zero storage migration.
 * `now` is accepted for symmetry with other services and possible future use; the
 * result does not currently depend on it.
 *
 * @returns the schedule, or null when the question has no attempts (not in the ladder).
 */
export function scheduleFor(attempts: Attempt[], _now: string): ReviewSchedule | null {
  if (attempts.length === 0) return null;

  const ordered = [...attempts].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );

  let step = 0;
  for (const a of ordered) {
    if (a.rating === 'correct') step = Math.min(step + 1, MAX_STEP);
    // partial / incorrect: hold the current step.
  }

  const lastReviewedAt = ordered[ordered.length - 1]!.createdAt;
  const nextReviewDate = addDays(lastReviewedAt, intervalDays(step));
  return { step, lastReviewedAt, nextReviewDate };
}
