import { html } from '@/lib/html';
import './SessionPause.css';

export interface SessionPauseProps {
  mode: 'learn' | 'revisit';
  /** Running session count to display in the tally. */
  count: number;
  /** Milestone headline, e.g. "Chapter 1 done!" or "Nice — 10 reviews done!". */
  title: string;
  /** Continue the loop — render the (already-fetched) next item; count NOT reset. */
  onContinue: () => void;
  /** End the session — caller resets the mode and navigates home. */
  onBreak: () => void;
}

/**
 * The session pause checkpoint — a celebratory card shown between items when a
 * boundary is crossed (Learn: a new chapter; Practice: every N reviews). Ports
 * docs/mocks/session-pause.html. Accent (green/purple) is themed by `mode`.
 */
export function SessionPause(props: SessionPauseProps): HTMLElement {
  const countLabel = props.mode === 'learn' ? 'problems this session' : 'reviews this session';
  const sub = props.mode === 'learn'
    ? 'Nice work — take a breather or keep the momentum going.'
    : 'Good rhythm. Rest your brain, or keep clearing the queue.';

  const breakBtn = html`<button class="pause-btn pb-break" type="button">Take a break</button>`;
  const continueBtn = html`<button class="pause-btn pb-continue" type="button">Keep going</button>`;
  breakBtn.addEventListener('click', () => props.onBreak());
  continueBtn.addEventListener('click', () => props.onContinue());

  const card = html`<div class="session-pause animate-in" style="--i: 0">
    <div class="pause-badge" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7" /></svg>
    </div>
    <h1 class="pause-title">${props.title}</h1>
    <p class="pause-sub">${sub}</p>
    <div class="pause-count">
      <span class="pc-num">${props.count}</span>
      <span class="pc-lbl">${countLabel}</span>
    </div>
    <div class="pause-actions">${breakBtn}${continueBtn}</div>
  </div>`;
  card.dataset.mode = props.mode;
  return card;
}
