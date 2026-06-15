import './MasteryPill.css';
import type { Mastery } from '@/lib/types';

const MASTERY_LABEL: Record<Mastery, string> = {
  new: 'New',
  improving: 'Improving',
  strong: 'Strong',
  excellent: 'Excellent',
};

/**
 * The mastery word as a pill (New / Improving / Strong / Excellent), tinted by a
 * green ramp — deeper green = better established. This is the "how well known"
 * signal; readiness (when it next comes up) is shown separately on the row. Used
 * by the read-only book view.
 */
export function MasteryPill(mastery: Mastery): HTMLElement {
  const el = document.createElement('span');
  el.className = `mastery-pill est-${mastery}`;
  el.textContent = MASTERY_LABEL[mastery];
  return el;
}
