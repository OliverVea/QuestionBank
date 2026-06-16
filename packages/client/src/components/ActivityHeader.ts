import { html } from '@/lib/html';
import type { Activity } from '@/lib/types';
import './ActivityHeader.css';

/**
 * The global activity header: three metrics in a row — day streak, days/week
 * goal, problems/week goal. Goals show `actual / target` and turn green when met.
 */
export function ActivityHeader(activity: Activity): HTMLElement {
  const streak = stat('stat-streak', String(activity.streak), null, 'day streak');
  const days = stat(
    'stat-days', String(activity.daysActive), String(activity.daysGoal), 'days this week',
  );
  if (activity.daysActive >= activity.daysGoal) days.classList.add('complete');
  const problems = stat(
    'stat-problems', String(activity.problemsThisWeek), String(activity.problemsGoal), 'problems this week',
  );
  if (activity.problemsThisWeek >= activity.problemsGoal) problems.classList.add('complete');

  return html`<section class="activity" aria-label="Your activity">
    <div class="activity-head">
      ${streak}
      ${days}
      ${problems}
    </div>
  </section>`;
}

/** One metric column: a big number (optionally `/ target`) over an uppercase label. */
function stat(id: string, actual: string, target: string | null, label: string): HTMLElement {
  const of = target === null ? '' : ` / ${target}`;
  const el = html`<div class="stat">
    <span class="stat-num"><span></span><span class="stat-of"></span></span>
    <span class="stat-lbl"></span>
  </div>`;
  el.id = id;
  const nums = el.querySelectorAll('.stat-num > span');
  nums[0]!.textContent = actual;
  (nums[1] as HTMLElement).textContent = of;
  el.querySelector('.stat-lbl')!.textContent = label;
  return el;
}
