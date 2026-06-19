// packages/client/tests/unit/pages/grade/GraderBubble.test.ts
import { describe, test, expect } from 'vitest';
import { GraderBubble } from '@/pages/grade/GraderBubble';
import type { GradePayload } from '@/pages/grade/conversation';

const base = (over: Partial<GradePayload> = {}): GradePayload => ({
  reasoning: 'because', issues: [], recommendedGrade: 'correct', ...over,
});

describe('GraderBubble', () => {
  test('base agent bubble classes are present', () => {
    const el = GraderBubble(base());
    expect(el.classList.contains('chat-bubble')).toBe(true);
    expect(el.classList.contains('chat-bubble-agent')).toBe(true);
  });

  test('no issues → grade badge + "no issues" line', () => {
    const el = GraderBubble(base());
    expect(el.querySelector('.grade-badge')?.textContent).toBe('correct');
    expect(el.querySelector('.grade-ok')).not.toBeNull();
    expect(el.querySelector('.issue-list')).toBeNull();
  });

  test('issues → one row per issue with severity + description', () => {
    const el = GraderBubble(base({
      recommendedGrade: 'partial',
      issues: [
        { severity: 'critical', description: 'missing d' },
        { severity: 'minor', description: 'justify denominator' },
      ],
    }));
    expect(el.querySelector('.grade-badge')?.textContent).toBe('partial');
    expect(el.querySelectorAll('.issue')).toHaveLength(2);
    expect(el.querySelector('.issue-critical .issue-sev')?.textContent).toBe('critical');
    expect(el.textContent).toContain('missing d');
  });

  test('reasoning is in a collapsed details element', () => {
    const el = GraderBubble(base());
    const det = el.querySelector('details.reasoning') as HTMLDetailsElement;
    expect(det).not.toBeNull();
    expect(det.open).toBe(false);
    expect(det.textContent).toContain('because');
  });
});
