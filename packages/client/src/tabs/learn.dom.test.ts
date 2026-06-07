// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Question } from '../api/types.js';

// Mock the API module so the answer view runs without a server. Each test asserts
// against these spies to verify the text-input answer modality (3c): a typed answer
// alone must NOT trigger transcription, and a typed answer combines with a photo
// transcription when grading.
const transcribeAnswer = vi.fn();
const gradeTurn = vi.fn();
const createAttempt = vi.fn();

vi.mock('../api/client.js', () => ({
  api: {
    transcribeAnswer: (...args: unknown[]) => transcribeAnswer(...args),
    gradeTurn: (...args: unknown[]) => gradeTurn(...args),
    createAttempt: (...args: unknown[]) => createAttempt(...args),
  },
}));

// Imported after the mock is registered.
const { renderAnswerView } = await import('./learn.js');

const question: Question = {
  id: 'q1',
  chapterId: 'c1',
  canonicalText: 'Solve x',
  source: { kind: 'text', rawText: 'Solve x' },
  createdAt: '2026-06-07T00:00:00.000Z',
};

let host: HTMLElement;

beforeEach(() => {
  transcribeAnswer.mockReset();
  gradeTurn.mockReset().mockResolvedValue({ reasoning: '', issues: [], recommendedGrade: 'correct' });
  createAttempt.mockReset().mockResolvedValue({ id: 'a1' });
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

/** Wait a microtask turn so the async transcribe/grade handlers settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('renderAnswerView — text-input answer modality (3c)', () => {
  it('disables continue until a photo or typed text is present', () => {
    renderAnswerView(host, question, () => {});
    const btn = host.querySelector<HTMLButtonElement>('.learn-transcribe')!;
    expect(btn.disabled).toBe(true);

    const typed = host.querySelector<HTMLTextAreaElement>('.learn-typed')!;
    typed.value = 'my answer';
    typed.dispatchEvent(new Event('input'));
    expect(btn.disabled).toBe(false);
  });

  it('typed-only answer skips transcription entirely', async () => {
    renderAnswerView(host, question, () => {});
    const typed = host.querySelector<HTMLTextAreaElement>('.learn-typed')!;
    typed.value = 'x = 4';
    typed.dispatchEvent(new Event('input'));

    host.querySelector<HTMLButtonElement>('.learn-transcribe')!.click();
    await flush();

    // No photos → the transcription LLM call must not happen.
    expect(transcribeAnswer).not.toHaveBeenCalled();

    // The confirm step shows the typed answer and no transcription/retranscribe UI.
    expect(host.querySelector('.learn-typed-view')).not.toBeNull();
    expect(host.querySelector('.learn-retranscribe')).toBeNull();
  });

  it('grades the typed-only answer (combined answer === typed text)', async () => {
    renderAnswerView(host, question, () => {});
    const typed = host.querySelector<HTMLTextAreaElement>('.learn-typed')!;
    typed.value = 'x = 4';
    typed.dispatchEvent(new Event('input'));
    host.querySelector<HTMLButtonElement>('.learn-transcribe')!.click();
    await flush();

    host.querySelector<HTMLButtonElement>('.learn-grade-go')!.click();
    await flush();

    expect(gradeTurn).toHaveBeenCalledTimes(1);
    const call = gradeTurn.mock.calls[0] as [string, { conversation: { text: string }[] }];
    expect(call[1].conversation[0]!.text).toBe('x = 4');
  });
});
