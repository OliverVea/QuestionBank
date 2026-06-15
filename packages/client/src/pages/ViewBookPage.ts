import { html } from '@/lib/html';
import { TopBar } from '@/components/TopBar';
import { CoverSlot } from '@/components/CoverSlot';
import { Spinner } from '@/components/Spinner';
import { MasteryPill } from '@/components/MasteryPill';
import { CiStrip } from '@/components/CiStrip';
import { renderLatex } from '@/lib/latex';
import { groupByPath, chapterTotal, type Chapter, type IndexedProblem } from '@/lib/problem-grouping';
import type { Book, QuestionWithSummary } from '@/lib/types';
import './ViewBookPage.css';

/**
 * Read-only book view: cover + details header, then the book's problems fanned out
 * by their dotted path into two collapsible levels (chapter ▸ section). Each row
 * shows the problem, its mastery pill + CI-history strip, and the readiness/timing
 * of when it next comes up, and links to the attempt-history subpage.
 *
 * ORDER is the server's (the questions GET returns problems pre-sorted by path);
 * this page only GROUPS — it never re-sorts. Group headers toggle expand/collapse
 * and never navigate; collapse state is in-memory, default expanded.
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

  // Continues the header's animate-in cascade (head=0, listhead=1).
  let stagger = 2;

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
      for (const chapter of groupByPath(problems)) listEl.appendChild(chapterGroup(chapter));
    } catch {
      // Leave the (empty) header/list; a load failure just shows nothing.
    }
    spinner.remove();
    head.hidden = false;
    listHead.hidden = false;
  }

  /** A chapter group: header + its direct problems, then its lettered subsections. */
  function chapterGroup(chapter: Chapter): HTMLElement {
    const isUngrouped = chapter.name == null;
    const groupEl = html`<li class="vb-group"></li>`;
    const header = makeHeader(isUngrouped ? [] : [chapter.name!], isUngrouped, chapterTotal(chapter));
    wireToggle(header, groupEl);

    const rows = html`<div class="vb-group-rows"></div>`;
    // Direct chapter problems FIRST (loose, before lettered subsections).
    for (const entry of chapter.direct) rows.appendChild(makeRow(entry));
    // Then subsections in first-seen (already path-sorted) order.
    for (const [section, items] of chapter.sections) {
      rows.appendChild(subGroup(chapter.name!, section, items));
    }

    groupEl.append(header, rows);
    return groupEl;
  }

  /** A subsection (chapter ▸ section): its own quieter header + rows. */
  function subGroup(chapter: string, section: string, items: IndexedProblem[]): HTMLElement {
    const subEl = html`<div class="vb-subgroup"></div>`;
    const subHeader = makeHeader([chapter, section], false, items.length);
    subHeader.classList.add('is-sub');
    wireToggle(subHeader, subEl);
    const subRows = html`<div class="vb-group-rows"></div>`;
    for (const entry of items) subRows.appendChild(makeRow(entry));
    subEl.append(subHeader, subRows);
    return subEl;
  }

  /** A collapsible group header: breadcrumb + count + caret. Toggles only — never navigates. */
  function makeHeader(segments: string[], isUngrouped: boolean, n: number): HTMLElement {
    const header = html`<button type="button" class="vb-group-head animate-in" aria-expanded="true"></button>`;
    header.style.setProperty('--i', String(stagger++));

    const crumb = html`<span class="vb-crumb"></span>`;
    if (isUngrouped) {
      const seg = html`<span class="vb-crumb-seg lvl-other"></span>`;
      seg.textContent = 'Ungrouped';
      crumb.appendChild(seg);
    } else {
      segments.forEach((segment, si) => {
        if (si > 0) {
          const sep = html`<span class="vb-crumb-sep" aria-hidden="true">›</span>`;
          crumb.appendChild(sep);
        }
        const seg = html`<span class="vb-crumb-seg"></span>`;
        seg.classList.add(`lvl-${Math.min(si, 3)}`);
        seg.textContent = segment;
        crumb.appendChild(seg);
      });
    }

    const count = html`<span class="vb-group-n"></span>`;
    count.textContent = String(n);
    const caret = html`<span class="vb-group-caret" aria-hidden="true">⌄</span>`;

    header.append(crumb, count, caret);
    return header;
  }

  /** Wire a header to expand/collapse its group body. In-memory only. */
  function wireToggle(header: HTMLElement, groupEl: HTMLElement): void {
    header.addEventListener('click', () => {
      const collapsed = groupEl.classList.toggle('collapsed');
      header.setAttribute('aria-expanded', String(!collapsed));
    });
  }

  /** One problem row: label chip + clamped body + mastery/CI + readiness + chevron. */
  function makeRow({ p, i }: IndexedProblem): HTMLElement {
    const label = html`<span class="vb-label"></span>`;
    label.textContent = p.label !== '' ? p.label : String(i + 1);

    const body = html`<div class="vb-body qbody"></div>`;
    renderLatex(body, p.canonicalText, '');

    const badgeRow = html`<div class="vb-badge-row"></div>`;
    badgeRow.appendChild(MasteryPill(p.summary.mastery));
    if (p.summary.grades.length > 0) {
      badgeRow.appendChild(CiStrip(p.summary.grades, { cap: 8 }));
    }

    const ready = html`<span class="vb-ready"></span>`;
    applyReadiness(ready, p.summary.readiness, p.summary.nextReviewDate);

    const row = html`<a class="vb-row animate-in">
      ${label}
      ${body}
      ${badgeRow}
      ${ready}
      <span class="vb-chev" aria-hidden="true">›</span>
    </a>`;
    row.style.setProperty('--i', String(stagger++));
    row.setAttribute(
      'href',
      `#/attempts?questionId=${encodeURIComponent(p.id)}&bookId=${encodeURIComponent(bookId)}`,
    );
    return row;
  }
}

/**
 * Fill the readiness column. `ready` → "Ready now" (purple; covers overdue too —
 * a past due date is just ready). `waiting` → relative "Ready in N days" from the
 * server's nextReviewDate. `finalized` → empty (graduated, off the schedule).
 */
function applyReadiness(el: HTMLElement, readiness: string, nextReviewDate?: string): void {
  if (readiness === 'finalized') return; // graduated — no next
  if (readiness === 'waiting') {
    el.classList.add('r-waiting');
    el.textContent = nextReviewDate ? `Ready in ${daysUntil(nextReviewDate)}` : 'Resting';
    return;
  }
  el.classList.add('r-ready');
  el.textContent = 'Ready now';
}

/** Whole days from now until `iso` (≥ 1 by construction for a waiting problem), as "N days". */
function daysUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.max(1, Math.ceil(ms / 86_400_000));
  return `${days} day${days === 1 ? '' : 's'}`;
}
