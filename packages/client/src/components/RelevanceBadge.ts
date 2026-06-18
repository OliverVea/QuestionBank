import './RelevanceBadge.css';
import type { Relevance } from '@/lib/types';

const RELEVANCE_LABEL: Record<Relevance, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/**
 * The question's relevance to the book's learning goal as a pill (High / Medium /
 * Low), tinted green→orange→grey. This is the "how worth learning" signal that
 * drives learn-next ordering; here it's read-only context on the book view, shown
 * alongside the mastery pill. Editing happens in ProblemRow's dropdown.
 */
export function RelevanceBadge(relevance: Relevance): HTMLElement {
  const el = document.createElement('span');
  el.className = `relevance-badge rel-${relevance}`;
  el.textContent = RELEVANCE_LABEL[relevance];
  return el;
}
