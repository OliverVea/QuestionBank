import { api } from '../api/client.js';
import type { DueItem, Question } from '../api/types.js';
import { renderContent } from '../render/content.js';
import { renderAnswerView } from './learn.js';

/** Human label for a ladder step. */
function stepLabel(step: number): string {
  if (step >= 2) return 'monthly';
  if (step === 1) return 'weekly';
  return 'new';
}

/** Render the spaced-repetition Practice tab: the due queue, with a full-grading review per item. */
export function renderPractice(host: HTMLElement): void {
  host.innerHTML = '';
  const heading = document.createElement('h2');
  heading.textContent = 'Practice';
  host.appendChild(heading);

  const listHost = document.createElement('div');
  listHost.className = 'practice-list';
  host.appendChild(listHost);

  function openReview(question: Question): void {
    host.innerHTML = '';
    renderAnswerView(host, question, () => renderPractice(host));
  }

  function reload(): void {
    listHost.innerHTML = 'loading…';
    void (async () => {
      const due = await api.getPracticeDue();
      listHost.innerHTML = '';
      if (due.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'practice-empty';
        empty.textContent = 'Nothing due for review right now — check back later.';
        listHost.appendChild(empty);
        return;
      }
      for (const item of due) listHost.appendChild(renderDueRow(item, openReview));
    })();
  }

  reload();
}

/** One due item: book/chapter context, the question, its step, and a Review button. */
function renderDueRow(item: DueItem, openReview: (q: Question) => void): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card practice-item';

  const meta = document.createElement('div');
  meta.className = 'practice-meta';
  meta.textContent = `${item.book.title} — ${item.chapter.title} · ${stepLabel(item.schedule.step)}`;
  card.appendChild(meta);

  if (item.question.label) {
    const label = document.createElement('div');
    label.className = 'qlabel';
    label.textContent = item.question.label;
    card.appendChild(label);
  }

  const body = document.createElement('div');
  body.className = 'qbody';
  renderContent(body, item.question.canonicalText);
  card.appendChild(body);

  const row = document.createElement('div');
  row.className = 'row';
  const review = document.createElement('button');
  review.className = 'btn practice-review';
  review.textContent = 'Review';
  review.addEventListener('click', () => openReview(item.question));
  row.appendChild(review);
  card.appendChild(row);

  return card;
}
