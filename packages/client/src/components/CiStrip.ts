import './CiStrip.css';
import type { Grade } from '@/lib/types';

export interface CiStripOptions {
  /** Bigger tick variant (used atop the attempt-history subpage). */
  large?: boolean;
  /** Cap the number of ticks shown, keeping the newest. 0/undefined = all. */
  cap?: number;
}

/**
 * The CI-history strip: one tick per attempt, oldest→newest. Colored by grade —
 * incorrect = orange, partial = green outline, correct = solid green.
 */
export function CiStrip(grades: Grade[], opts: CiStripOptions = {}): HTMLElement {
  const strip = document.createElement('span');
  strip.className = 'ci-strip' + (opts.large ? ' lg' : '');
  const list = opts.cap && opts.cap > 0 ? grades.slice(-opts.cap) : grades;
  for (const g of list) {
    const tick = document.createElement('span');
    tick.className = `ci-tick t-${g}`;
    tick.title = g;
    strip.appendChild(tick);
  }
  return strip;
}
