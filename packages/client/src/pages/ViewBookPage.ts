import { html } from '@/lib/html';
import { TopBar } from '@/components/TopBar';
import { CoverSlot } from '@/components/CoverSlot';
import { Spinner } from '@/components/Spinner';
import { StatusBadge } from '@/components/StatusBadge';
import { CiStrip } from '@/components/CiStrip';
import { renderLatex } from '@/lib/latex';
import type { Book, QuestionWithSummary } from '@/lib/types';
import './ViewBookPage.css';

/**
 * Read-only book view: cover + details header, then the book's flat problem list.
 * Each row shows the problem, its status badge (mastery word / readiness color)
 * and its CI-history strip, and links to the attempt-history subpage. The "open a
 * book and see how you're doing" screen — distinct from (and not linked to) the
 * editor, by design.
 */
export function ViewBookPage(): HTMLElement {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const bookId = params.get('id') || '';

  const titleEl = html`<div class="vb-title">Book</div>`;
  const authorEl = html`<div class="vb-author"></div>`;
  const metaEl = html`<div class="vb-meta" hidden></div>`;
  let coverSlot = CoverSlot({});

  const countEl = html`<span class="vb-n"></span>`;
  const listEl = html`<ol class="vb-list"></ol>`;
  const spinner = Spinner();

  const head = html`<section class="vb-head animate-in" style="--i: 0">
    ${coverSlot}
    <div>
      ${titleEl}
      ${authorEl}
      ${metaEl}
    </div>
  </section>`;
  head.hidden = true;

  const listHead = html`<div class="vb-listhead animate-in" style="--i: 1">
    <h2>Problems</h2>
    ${countEl}
  </div>`;
  listHead.hidden = true;

  const page = html`<div class="view-book-page app gridpad">
    ${TopBar({ onBack: () => { window.location.hash = '#/'; } })}
    <div class="vb-scroll">
      ${spinner}
      ${head}
      ${listHead}
      ${listEl}
    </div>
  </div>`;

  void load();
  return page;

  async function load(): Promise<void> {
    if (!bookId) { spinner.remove(); return; }
    try {
      const [book, problems]: [Book, QuestionWithSummary[]] = await Promise.all([
        fetch(`/api/books/${bookId}`).then((r) => r.json()),
        fetch(`/api/books/${bookId}/questions`).then((r) => r.json()),
      ]);

      titleEl.textContent = book.title;
      authorEl.textContent = book.author ?? '';
      const meta = [book.publisher, book.year].filter(Boolean).join(' · ');
      metaEl.textContent = meta;
      metaEl.hidden = meta === '';

      const newCover = CoverSlot({ title: book.title, isbn: book.isbn });
      coverSlot.replaceWith(newCover);
      coverSlot = newCover;

      countEl.textContent = `${problems.length} problem${problems.length === 1 ? '' : 's'}`;
      problems.forEach((p, i) => listEl.appendChild(problemRow(p, i)));
    } catch {
      // Leave the (empty) header/list; a load failure just shows nothing.
    }
    spinner.remove();
    head.hidden = false;
    listHead.hidden = false;
  }

  function problemRow(p: QuestionWithSummary, i: number): HTMLElement {
    const label = html`<span class="vb-label"></span>`;
    label.textContent = p.label !== '' ? p.label : String(i + 1);

    const body = html`<div class="vb-body qbody"></div>`;
    renderLatex(body, p.canonicalText, '');

    const badgeRow = html`<div class="vb-badge-row"></div>`;
    badgeRow.appendChild(StatusBadge(p.summary.mastery, p.summary.readiness));
    if (p.summary.grades.length > 0) {
      badgeRow.appendChild(CiStrip(p.summary.grades, { cap: 8 }));
    }

    const row = html`<a class="vb-row animate-in">
      ${label}
      ${body}
      ${badgeRow}
      <span class="vb-chev" aria-hidden="true">›</span>
    </a>`;
    row.style.setProperty('--i', String(2 + i));
    row.setAttribute(
      'href',
      `#/attempts?questionId=${encodeURIComponent(p.id)}&bookId=${encodeURIComponent(bookId)}`,
    );
    return row;
  }
}
