// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DueItem } from '../api/types.js';

const getPracticeDue = vi.fn();

vi.mock('../api/client.js', () => ({
  api: { getPracticeDue: (...a: unknown[]) => getPracticeDue(...a) },
}));

// renderAnswerView is invoked on "Review"; stub it so the test doesn't pull the full flow.
const renderAnswerView = vi.fn();
vi.mock('./learn.js', () => ({
  renderAnswerView: (...a: unknown[]) => renderAnswerView(...a),
}));

const { renderPractice } = await import('./practice.js');

function due(id: string, label: string, nextReviewDate: string): DueItem {
  return {
    question: {
      id,
      chapterId: 'c1',
      label,
      canonicalText: `Q ${label}`,
      source: { kind: 'text', rawText: 'x' },
      createdAt: '2026-06-01T00:00:00.000Z',
    },
    book: { id: 'b1', title: 'Book', createdAt: '2026-06-01T00:00:00.000Z' },
    chapter: { id: 'c1', bookId: 'b1', title: 'Chapter', order: 0, createdAt: '2026-06-01T00:00:00.000Z' },
    schedule: { step: 1, lastReviewedAt: '2026-05-01T00:00:00.000Z', nextReviewDate },
  };
}

let host: HTMLElement;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  getPracticeDue.mockReset();
  renderAnswerView.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => host.remove());

describe('renderPractice', () => {
  it('shows the empty state when nothing is due', async () => {
    getPracticeDue.mockResolvedValue([]);
    renderPractice(host);
    await flush();
    expect(host.querySelector('.practice-empty')).not.toBeNull();
    expect(host.querySelector('.practice-item')).toBeNull();
  });

  it('renders one row per due item, most overdue first', async () => {
    getPracticeDue.mockResolvedValue([
      due('q1', '1.1', '2026-06-01T00:00:00.000Z'),
      due('q2', '1.2', '2026-06-03T00:00:00.000Z'),
    ]);
    renderPractice(host);
    await flush();
    const rows = host.querySelectorAll('.practice-item');
    expect(rows).toHaveLength(2);
  });

  it('clicking Review opens the answer view for that question', async () => {
    getPracticeDue.mockResolvedValue([due('q1', '1.1', '2026-06-01T00:00:00.000Z')]);
    renderPractice(host);
    await flush();
    host.querySelector<HTMLButtonElement>('.practice-review')!.click();
    expect(renderAnswerView).toHaveBeenCalledTimes(1);
    const call = renderAnswerView.mock.calls[0] as [HTMLElement, { id: string }, () => void];
    expect(call[1].id).toBe('q1');
  });
});
