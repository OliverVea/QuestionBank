import { html } from '@/lib/html';
import { ProblemRow, type ProblemRowHandle } from '@/components/ProblemRow';
import type { Relevance } from '@/lib/types';
import { PhotoReviewModal } from '@/components/PhotoReviewModal';
import { ImageSourcePicker } from '@/components/ImageSourcePicker';
import { stashPhotos } from '@/lib/photo-transfer';
import './ProblemsList.css';

const SCAN_ACCEPTED_KEY = 'qb-scan-accepted';

export interface Problem {
  id?: string;
  label: string;
  latex: string;
  relevance?: Relevance;
  /** When present (scan-edit handoff), this replaces the existing row with this id. */
  targetId?: string;
}

export interface ProblemsListProps {
  problems?: Problem[];
  onChange?: () => void;
  /** Supplier for the current learning goal (may change after mount). */
  getLearningGoal?: () => string;
  /** The book being scanned into — threaded to the scan stash so /extract can load existing problems. */
  bookId?: string;
}

export interface ProblemsListHandle {
  el: HTMLElement;
  getProblems: () => Problem[];
  addRow: (problem?: Problem, focus?: boolean) => void;
  /**
   * Apply problems handed back from the scan page (from sessionStorage). Call this AFTER
   * existing problems have loaded so `edit` deltas can match their target row. Returns
   * true if any problems were applied (so the host can persist the merged list).
   */
  applyReturnedProblems: () => boolean;
  /** Replace the entire row set — used to resync to the server's saved list (with ids). */
  setProblems: (problems: Problem[]) => void;
}

export function ProblemsList({ problems = [], onChange, getLearningGoal, bookId }: ProblemsListProps = {}): ProblemsListHandle {
  const rows: ProblemRowHandle[] = [];
  const rowIds: (string | undefined)[] = [];
  const list = document.createElement('ol');
  list.className = 'problem-list';

  const notify = () => { renumber(); onChange?.(); };

  function renumber() {
    rows.forEach((r, i) => r.setAutoLabel(i + 1));
  }

  function addRow(problem: Problem = { label: '', latex: '' }, focus = false) {
    const handle = ProblemRow({
      label: problem.label,
      latex: problem.latex,
      relevance: (problem.relevance ?? '') as Relevance,
      onChange: notify,
      onDelete: () => {
        const i = rows.indexOf(handle);
        if (i >= 0) { rows.splice(i, 1); rowIds.splice(i, 1); }
        handle.el.remove();
        notify();
      },
    });
    rows.push(handle);
    rowIds.push(problem.id);
    list.appendChild(handle.el);
    renumber();
    if (focus) handle.enterEdit();
  }

  /** Replace the entire row set (e.g. resync to the server's authoritative list, with ids). */
  function setProblems(next: Problem[]) {
    for (const r of rows) r.el.remove();
    rows.length = 0;
    rowIds.length = 0;
    for (const p of next) addRow(p);
    renumber();
  }

  // --- Scan problems: pick from camera or device, review, then navigate ---
  function openReview(selected: File[]) {
    if (!selected.length) return;
    const modal = PhotoReviewModal({
      initialFiles: selected,
      onPost({ files: posted, notes }) {
        if (!posted.length) return;
        const goal = getLearningGoal?.();
        stashPhotos({ files: posted, notes, ...(bookId ? { bookId } : {}), ...(goal ? { learningGoal: goal } : {}) });
        // The figure wizard supersedes the chat scan UI; it commits problems + figures itself.
        window.location.hash = '#/figure-scan';
      },
      onCancel() { /* stay on page */ },
    });
    document.body.appendChild(modal);
  }

  const scanHead = html`<div class="scan-problems-head">Scan a problems page</div>`;
  const scanPicker = ImageSourcePicker({ onFiles: openReview });
  const scanBlock = html`<div class="scan-problems">${scanHead}${scanPicker}</div>`;

  // Apply problems handed back from the scan page. An `edit` (targetId set) replaces the
  // existing row with that id; everything else is a new row. relevance rides through.
  // Called by the host AFTER existing problems have loaded, so an `edit` can find its
  // target row (otherwise it would fall back to appending a duplicate). Returns whether
  // anything was applied, so the host can persist the merged list.
  function applyReturnedProblems(): boolean {
    const raw = sessionStorage.getItem(SCAN_ACCEPTED_KEY);
    if (!raw) return false;
    sessionStorage.removeItem(SCAN_ACCEPTED_KEY);
    try {
      const accepted: Problem[] = JSON.parse(raw);
      if (accepted.length === 0) return false;
      for (const p of accepted) {
        if (p.targetId) {
          replaceRowById(p.targetId, { id: p.targetId, label: p.label, latex: p.latex, ...(p.relevance ? { relevance: p.relevance } : {}) });
        } else {
          addRow(p);
        }
      }
      notify();
      return true;
    } catch { /* ignore malformed */ return false; }
  }

  /**
   * Replace the row whose problem id === `id` with a fresh row carrying `next` (same id),
   * in place. Falls back to appending if the id isn't in the current working set.
   */
  function replaceRowById(id: string, next: Problem) {
    const i = rowIds.indexOf(id);
    if (i < 0) { addRow(next); return; }
    const handle = ProblemRow({
      label: next.label,
      latex: next.latex,
      relevance: (next.relevance ?? '') as Relevance,
      onChange: notify,
      onDelete: () => {
        const j = rows.indexOf(handle);
        if (j >= 0) { rows.splice(j, 1); rowIds.splice(j, 1); }
        handle.el.remove();
        notify();
      },
    });
    const old = rows[i]!;
    old.el.replaceWith(handle.el);
    rows[i] = handle;
    rowIds[i] = id;
    renumber();
  }

  // Seed initial problems.
  for (const p of problems) addRow(p);
  // Note: returned scan results are applied by the host via applyReturnedProblems(),
  // AFTER existing problems have loaded — not on mount — so edit-deltas can match.

  const addBtn = html`<button class="add-problem" type="button">
    <span class="plus" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 5v14" /><path d="M5 12h14" />
      </svg>
    </span>
    Add a problem
  </button>`;
  addBtn.addEventListener('click', () => { addRow({ label: '', latex: '' }, true); notify(); });

  const wrapper = html`<div class="problems">
    <div class="problems-head"><h2>Problems</h2></div>
    ${scanBlock}
    ${list}
    ${addBtn}
  </div>`;

  return {
    el: wrapper,
    getProblems: () => rows.map((r, i) => {
      const p: Problem = { label: r.getLabel(), latex: r.getLatex() };
      if (rowIds[i]) p.id = rowIds[i];
      const rel = r.getRelevance();
      if (rel) p.relevance = rel;
      return p;
    }),
    addRow,
    applyReturnedProblems,
    setProblems,
  };
}
