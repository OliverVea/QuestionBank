import type { Attempt, Grade, Mastery, ProblemSummary, Readiness } from '../domain/types.js';
import { scheduleFor, type ReviewSchedule } from './srs.js';

/** Numeric weight per grade for the mastery average. */
const GRADE_WEIGHT: Record<Grade, number> = { correct: 1, partial: 0.5, incorrect: 0 };

/** How many recent attempts feed the mastery word. */
const MASTERY_WINDOW = 4;

/**
 * Minimum attempts before a problem can graduate to 'excellent'. Graduation maps
 * to 'finalized' (off the review ladder), so it must reflect a track record, not a
 * single lucky correct answer — mirrors the SRS ladder, which needs repeated
 * corrects to reach its top step.
 */
const EXCELLENT_MIN_ATTEMPTS = 3;

/**
 * Mastery word from the (oldest-first) grade list: weighted average of the last
 * few attempts. No attempts ⇒ 'new'. 'excellent' additionally requires a minimum
 * history so one correct answer can't graduate a problem. Mirrors
 * docs/mocks/attempt-summary.js (which lacked the min-history guard).
 */
function masteryFrom(grades: Grade[]): Mastery {
  if (grades.length === 0) return 'new';
  const recent = grades.slice(-MASTERY_WINDOW);
  const score = recent.reduce((s, g) => s + GRADE_WEIGHT[g], 0) / recent.length;
  if (score >= 0.85 && grades.length >= EXCELLENT_MIN_ATTEMPTS) return 'excellent';
  if (score >= 0.6) return 'strong';
  return 'improving';
}

/**
 * Readiness drives the badge color. An excellent problem is graduated ('finalized'),
 * never scheduled. A problem with no attempts is always 'ready' (incl. brand-new).
 * Otherwise the SRS schedule decides: due at/before `now` ⇒ 'ready', else 'waiting'.
 * `schedule` is the precomputed SRS schedule (null when never attempted) so the
 * caller can derive it once and also surface its nextReviewDate.
 */
function readinessFrom(schedule: ReviewSchedule | null, mastery: Mastery, now: string): Readiness {
  if (mastery === 'excellent') return 'finalized';
  if (schedule === null) return 'ready';
  return schedule.nextReviewDate <= now ? 'ready' : 'waiting';
}

/**
 * Derive the full per-problem summary from its attempts. Pure and total: the
 * single source of truth for the status badge + CI-history strip. `attempts` may
 * be in any order; `now` is an ISO timestamp. `nextReviewDate` is included only
 * when readiness is 'waiting' (a future due date) — the client renders the
 * relative "Ready in N days" from it.
 */
export function deriveSummary(attempts: Attempt[], now: string): ProblemSummary {
  const ordered = [...attempts].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );
  const grades = ordered.map((a) => a.rating);
  const mastery = masteryFrom(grades);
  const schedule = scheduleFor(attempts, now);
  const readiness = readinessFrom(schedule, mastery, now);
  return {
    mastery,
    readiness,
    grades,
    ...(readiness === 'waiting' && schedule ? { nextReviewDate: schedule.nextReviewDate } : {}),
  };
}
