import { describe, expect, it } from 'vitest';
import {
  buildGradingPrompt,
  deriveGrade,
  gradingTurnSchema,
  validateGradingTurn,
  type GradingIssue,
} from '@/llm/grading-contract.js';
import { LlmError } from '@/llm/provider.js';

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

describe('validateGradingTurn', () => {
  it('accepts a well-formed turn', () => {
    const raw = { reasoning: 'checked', issues: [{ severity: 'medium', description: 'sign error' }] };
    expect(validateGradingTurn(raw)).toEqual(raw);
  });

  it('accepts an empty issues list', () => {
    expect(validateGradingTurn({ reasoning: 'all good', issues: [] })).toEqual({
      reasoning: 'all good',
      issues: [],
    });
  });

  // The prod 500: the model returned `issues` as a non-array, crashing deriveGrade with
  // "issues.some is not a function". Must now surface as a handled LlmError (→ 502).
  it('rejects non-array issues', () => {
    expect(() => validateGradingTurn({ reasoning: 'x', issues: {} })).toThrow(LlmError);
  });

  it('rejects a non-object result', () => {
    expect(() => validateGradingTurn('nope')).toThrow(LlmError);
    expect(() => validateGradingTurn(null)).toThrow(LlmError);
  });

  it('rejects missing reasoning', () => {
    expect(() => validateGradingTurn({ issues: [] })).toThrow(LlmError);
  });

  it('rejects an issue with an unknown severity', () => {
    const raw = { reasoning: 'x', issues: [{ severity: 'fatal', description: 'd' }] };
    expect(() => validateGradingTurn(raw)).toThrow(LlmError);
  });

  it('rejects an issue missing its description', () => {
    const raw = { reasoning: 'x', issues: [{ severity: 'minor' }] };
    expect(() => validateGradingTurn(raw)).toThrow(LlmError);
  });
});

// Sonnet 5.5 declines a request that asks for the model's own reasoning (stop_reason
// "refusal", category reasoning_extraction), which failed the grade with a 502.
describe('grading request does not ask for the model\'s reasoning', () => {
  it('the schema has no reasoning field, and its check field validates', () => {
    expect(Object.keys(gradingTurnSchema.properties)).toEqual(['working_check', 'issues']);
    expect(validateGradingTurn({ working_check: 'each line holds', issues: [] })).toEqual({
      reasoning: 'each line holds',
      issues: [],
    });
  });

  it('the prompt does not ask the model to think aloud', () => {
    const prompt = buildGradingPrompt({ canonicalText: 'Evaluate $1 + 1$.' });
    expect(prompt).not.toMatch(/reasoning|scratchpad|step by step|think through/i);
  });
});
