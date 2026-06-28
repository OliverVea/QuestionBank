import { html } from '@/lib/html';
import { authFetch } from '@/lib/auth';
import { TopBar } from '@/components/TopBar';
import { Spinner } from '@/components/Spinner';
import { CiStrip } from '@/components/CiStrip';
import { renderLatex } from '@/lib/latex';
import type { Attempt, GradingIssue, Grade } from '@/lib/types';
import './AttemptsPage.css';

const TRASH_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M6 6l1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14" />
    <path d="M10 11v6M14 11v6" />
  </svg>`;

const CLOCK_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
       stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  </svg>`;

/** Relative date from an ISO timestamp, against the current clock. */
function relDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'A week ago';
  if (days < 30) return `${Math.round(days / 7)} weeks ago`;
  if (days < 60) return 'A month ago';
  return `${Math.round(days / 30)} months ago`;
}

/**
 * Attempt-history subpage: one problem's past attempts, reached from a problem
 * row on the read-only book view. Shows the problem at the top with its CI strip,
 * then the attempt list (each row collapses to grade + date; tap to reveal the
 * answer and grader issues; trash to delete). Back returns to the book view.
 */
export function AttemptsPage(): HTMLElement {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const questionId = params.get('questionId') || '';
  const bookId = params.get('bookId') || '';

  const backHash = bookId ? `#/view-book?id=${encodeURIComponent(bookId)}` : '#/';

  let attempts: Attempt[] = [];

  const eyebrow = html`<div class="ah-eyebrow">Problem</div>`;
  const qBody = html`<div class="ah-qbody qbody"></div>`;
  const summaryEl = html`<div class="ah-summary"></div>`;
  const contentEl = html`<div></div>`;
  const spinner = Spinner();

  const problemSection = html`<section class="ah-problem animate-in" style="--i: 0">
    ${eyebrow}
    ${qBody}
    ${summaryEl}
  </section>`;
  problemSection.hidden = true;

  const page = html`<div class="attempts-page app">
    ${TopBar({ onBack: () => { window.location.hash = backHash; } })}
    <div class="ah-scroll">
      ${spinner}
      ${problemSection}
      ${contentEl}
    </div>
  </div>`;

  void load();
  return page;

  async function load(): Promise<void> {
    if (!questionId) { spinner.remove(); return; }
    try {
      const [question, fetched]: [{ label?: string; canonicalText?: string; bookId?: string }, Attempt[]] =
        await Promise.all([
          authFetch(`/api/questions/${questionId}`).then((r) => r.json()),
          authFetch(`/api/questions/${questionId}/attempts`).then((r) => r.json()),
        ]);

      // Server returns attempts oldest-first; the CI strip wants that order.
      attempts = fetched;

      const label = question.label ? `Problem ${question.label}` : 'Problem';
      eyebrow.textContent = label;
      renderLatex(qBody, question.canonicalText ?? '', '');
    } catch {
      attempts = [];
    }
    spinner.remove();
    problemSection.hidden = false;
    renderSummary();
    render();
  }

  function gradesOldestFirst(): Grade[] {
    return attempts.map((a) => a.rating);
  }

  function renderSummary(): void {
    summaryEl.replaceChildren();
    if (attempts.length > 0) {
      summaryEl.appendChild(CiStrip(gradesOldestFirst(), { large: true }));
    }
  }

  function render(): void {
    if (attempts.length === 0) renderEmpty();
    else renderList();
  }

  function renderEmpty(): void {
    const wrap = html`<div class="ah-empty animate-in" style="--i: 1">
      <span class="ah-empty-icon" aria-hidden="true"></span>
      <h2>No attempts yet</h2>
      <p>Once you grade this problem, each attempt shows up here.</p>
    </div>`;
    wrap.querySelector('.ah-empty-icon')!.innerHTML = CLOCK_SVG;
    contentEl.replaceChildren(wrap);
  }

  function renderList(): void {
    const count = html`<span class="ah-count"></span>`;
    count.textContent = `${attempts.length} attempt${attempts.length === 1 ? '' : 's'}`;
    const head = html`<div class="ah-head animate-in" style="--i: 1"><h2>Past attempts</h2>${count}</div>`;

    const list = html`<ol class="ah-list"></ol>`;
    // Newest first.
    [...attempts].reverse().forEach((at, i) => list.appendChild(attemptRow(at, i + 2, count)));

    contentEl.replaceChildren(head, list);
  }

  function attemptRow(at: Attempt, animIndex: number, countEl: HTMLElement): HTMLElement {
    const pill = html`<span class="badge"></span>`;
    pill.classList.add(`grade-${at.rating}`);
    pill.textContent = at.rating;

    const date = html`<span class="at-date"></span>`;
    date.textContent = relDate(at.createdAt);

    const del = html`<button class="at-del" type="button" aria-label="Delete attempt"></button>`;
    del.innerHTML = TRASH_SVG;

    const ansBody = html`<div class="at-answer qbody"></div>`;
    renderLatex(ansBody, at.answer || '—', '');

    const det = html`<details class="attempt animate-in">
      <summary>
        ${pill}
        ${date}
        ${del}
        <span class="at-chev" aria-hidden="true">⌄</span>
      </summary>
      <div class="at-body">
        <div>
          <div class="at-section-lbl">Your answer</div>
          ${ansBody}
        </div>
        ${issuesBlock(at.issues)}
      </div>
    </details>`;
    det.style.setProperty('--i', String(animIndex));

    del.addEventListener('click', (e) => {
      // The button lives inside <summary>; stop the click from toggling open.
      e.preventDefault();
      e.stopPropagation();
      void doDelete(at, det, countEl);
    });

    return det;
  }

  function issuesBlock(issues: GradingIssue[]): HTMLElement | null {
    if (issues.length === 0) return null;
    const items = issues.map((iss) => {
      const li = html`<li class="at-issue"><span class="at-issue-sev"></span><span class="at-issue-text"></span></li>`;
      li.querySelector('.at-issue-sev')!.textContent = iss.severity;
      (li.querySelector('.at-issue-sev') as HTMLElement).classList.add(`sev-${iss.severity}`);
      li.querySelector('.at-issue-text')!.textContent = iss.description;
      return li;
    });
    const list = html`<ul class="at-issues"></ul>`;
    list.append(...items);
    return html`<div>
      <div class="at-section-lbl">Grader</div>
      ${list}
    </div>`;
  }

  async function doDelete(at: Attempt, det: HTMLElement, countEl: HTMLElement): Promise<void> {
    if (!window.confirm('Delete this attempt?')) return;
    try {
      const res = await authFetch(`/api/questions/${questionId}/attempts/${at.id}`, { method: 'DELETE' });
      if (!res.ok) return;
    } catch {
      return;
    }
    attempts = attempts.filter((x) => x.id !== at.id);

    const finish = () => {
      det.remove();
      if (attempts.length === 0) renderEmpty();
      else countEl.textContent = `${attempts.length} attempt${attempts.length === 1 ? '' : 's'}`;
    };
    det.classList.add('removing');
    det.addEventListener('animationend', finish, { once: true });
    if (getComputedStyle(det).animationName === 'none') finish();

    renderSummary(); // CI strip updates immediately
  }
}
