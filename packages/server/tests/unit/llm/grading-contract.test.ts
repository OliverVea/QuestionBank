import { describe, expect, it } from 'vitest';
import { deriveGrade, type GradingIssue } from '@/llm/grading-contract.js';

function issue(severity: GradingIssue['severity']): GradingIssue {
  return { severity, description: `${severity} issue` };
}

describe('deriveGrade', () => {
  it('no issues → correct', () => {
    expect(deriveGrade([])).toBe('correct');
  });

  it('only minor issues → correct', () => {
    expect(deriveGrade([issue('minor'), issue('minor')])).toBe('correct');
  });

  it('a medium issue → partial', () => {
    expect(deriveGrade([issue('medium')])).toBe('partial');
  });

  it('medium plus minor → partial', () => {
    expect(deriveGrade([issue('minor'), issue('medium')])).toBe('partial');
  });

  it('a critical issue → incorrect', () => {
    expect(deriveGrade([issue('critical')])).toBe('incorrect');
  });

  it('critical outranks medium and minor → incorrect', () => {
    expect(deriveGrade([issue('minor'), issue('medium'), issue('critical')])).toBe('incorrect');
  });
});
