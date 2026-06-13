import './StatusBadge.css';
import type { Mastery, Readiness } from '@/lib/types';

const MASTERY_LABEL: Record<Mastery, string> = {
  new: 'New',
  improving: 'Improving',
  strong: 'Strong',
  excellent: 'Excellent',
};

/**
 * The two-signal status pill. Its TEXT is the mastery word; its COLOR (via the
 * ready-* class) is the readiness: purple = ready/due, grey = waiting, green =
 * finalized/graduated. Both values are server-derived (see ProblemSummary).
 */
export function StatusBadge(mastery: Mastery, readiness: Readiness): HTMLElement {
  const el = document.createElement('span');
  el.className = `status-badge ready-${readiness}`;
  el.textContent = MASTERY_LABEL[mastery];
  return el;
}
