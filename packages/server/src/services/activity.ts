import type { Activity, Attempt } from '../domain/types.js';

/** Hardcoded weekly goal targets (a future settings UI will override these). */
export const DAYS_GOAL = 3;
export const PROBLEMS_GOAL = 20;

/** Rolling window length, in days (today + 6 prior). */
const WEEK_DAYS = 7;

/** Server-local calendar-day key for an ISO timestamp (dedup key only — not a display format). */
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Whole days between two timestamps, by server-local date (ignores time-of-day). */
function dayDelta(now: string, then: string): number {
  const n = new Date(now);
  const t = new Date(then);
  const nMid = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  const tMid = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  return Math.round((nMid - tMid) / 86_400_000);
}

/** The two weekly goal targets the activity header counts toward. */
export interface Goals {
  daysGoal: number;
  problemsGoal: number;
}

/** The fallback goals, used when a customer has no stored settings record. */
export const DEFAULT_GOALS: Goals = { daysGoal: DAYS_GOAL, problemsGoal: PROBLEMS_GOAL };

/**
 * Streak + rolling-week actuals from attempts. Streak = consecutive calendar days
 * ending today (or yesterday, if today not yet active) with ≥1 attempt. Week window =
 * the last WEEK_DAYS days, bucketed by server-local date. The `goals` are echoed back
 * onto the result (sourced from the customer's settings, defaulting to the constants). Pure.
 */
export function computeActivity(
  attempts: Attempt[],
  now: string,
  goals: Goals = DEFAULT_GOALS,
): Activity {
  const activeDays = new Set<number>();
  let problemsThisWeek = 0;
  const weekDays = new Set<string>();

  for (const a of attempts) {
    const delta = dayDelta(now, a.createdAt);
    if (delta >= 0) activeDays.add(delta);
    if (delta >= 0 && delta < WEEK_DAYS) {
      problemsThisWeek += 1;
      weekDays.add(dayKey(a.createdAt));
    }
  }

  // Streak: walk back from today; allow today (delta 0) to be missing.
  let streak = 0;
  for (let d = 0; d < 400; d++) {
    if (activeDays.has(d)) streak += 1;
    else if (d === 0) continue; // today not yet active is OK
    else break;
  }

  return {
    streak,
    daysActive: weekDays.size,
    problemsThisWeek,
    daysGoal: goals.daysGoal,
    problemsGoal: goals.problemsGoal,
  };
}
