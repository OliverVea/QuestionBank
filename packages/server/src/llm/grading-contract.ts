import { LATEX_DELIMITER_INSTRUCTION } from './latex-format.js';
import { LlmError } from './provider.js';

/** Context the grader is given about the question being answered. */
export interface GradingContext {
  canonicalText: string;
  chapterDescription?: string;
  bookLearningGoal?: string;
}

export type Grade = 'correct' | 'partial' | 'incorrect';
export type IssueSeverity = 'critical' | 'medium' | 'minor';

/** One problem the grader found with the student's answer. */
export interface GradingIssue {
  severity: IssueSeverity;
  description: string;
}

/**
 * What the model returns each turn. `reasoning` is its line-by-line check of the student's
 * working, kept apart from the issue list so the list holds only confirmed defects; an
 * empty list means correct. The model writes it under {@link CHECK_FIELD}.
 */
export interface GradingTurnResult {
  reasoning: string;
  issues: GradingIssue[];
}

/**
 * The schema field the model writes its check of the student's working into. It is
 * deliberately not called "reasoning", and the prompt never asks the model to think aloud
 * or keep a scratchpad: Sonnet 5.5 declines such requests (`stop_reason: "refusal"`,
 * category `reasoning_extraction`), which failed every grade of some problems. The model
 * thinks on its own; this field is an assessment of the student's work.
 */
const CHECK_FIELD = 'working_check';

const VALID_SEVERITIES = new Set<IssueSeverity>(['critical', 'medium', 'minor']);

/**
 * Validate the model's forced tool_use input against {@link gradingTurnSchema}. The
 * Anthropic API does not strictly enforce the input schema, so a stray response (e.g.
 * `issues` as an object instead of an array) would otherwise crash {@link deriveGrade}
 * with an uncaught TypeError → 500. Throwing {@link LlmError} here routes a malformed
 * grade through the grade route's existing 502 path instead. Mirrors the extraction
 * envelope validator.
 */
export function validateGradingTurn(raw: unknown): GradingTurnResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new LlmError('grading result is not an object');
  }
  const { issues } = raw as { issues?: unknown };
  const fields = raw as Record<string, unknown>;
  const reasoning = fields[CHECK_FIELD] ?? fields.reasoning;
  if (typeof reasoning !== 'string') {
    throw new LlmError('grading result missing reasoning');
  }
  if (!Array.isArray(issues)) {
    throw new LlmError('grading result issues must be an array');
  }
  const validated: GradingIssue[] = issues.map((item) => {
    if (typeof item !== 'object' || item === null) {
      throw new LlmError('grading issue is not an object');
    }
    const { severity, description } = item as { severity?: unknown; description?: unknown };
    if (typeof severity !== 'string' || !VALID_SEVERITIES.has(severity as IssueSeverity)) {
      throw new LlmError(`grading issue has invalid severity: ${String(severity)}`);
    }
    if (typeof description !== 'string') {
      throw new LlmError('grading issue missing description');
    }
    return { severity: severity as IssueSeverity, description };
  });
  return { reasoning, issues: validated };
}

/**
 * Derive the grade from the issue list — the model never picks the grade itself
 * (agents are heavily biased toward "partial"). Severity is a strict hierarchy:
 *   any critical  → incorrect
 *   else any medium → partial
 *   else (only minor, or none) → correct
 */
export function deriveGrade(issues: GradingIssue[]): Grade {
  if (issues.some((i) => i.severity === 'critical')) return 'incorrect';
  if (issues.some((i) => i.severity === 'medium')) return 'partial';
  return 'correct';
}

/**
 * System-framing prompt for a grading conversation. Sent as the first `user` message
 * ahead of the live transcript. The model checks the student's working, then reports
 * only CONFIRMED defects as ISSUES (with severities). We derive the grade in code via
 * deriveGrade — the model never picks a grade. There is no free-form critique field;
 * each issue's description IS the critique.
 */
export function buildGradingPrompt(ctx: GradingContext): string {
  const lines = [
    'You are grading a student\'s answer to ONE specific titled question.',
    'Grade only this single question. Do not solve other problems, wander to adjacent',
    'exercises, or introduce material beyond what is needed to judge THIS answer.',
    'React to the student\'s answer. Do not independently produce a full worked solution.',
    '',
    'Return two things:',
    `1. In "${CHECK_FIELD}", a check of the student's working: go through it line by line,`,
    '   say whether each line is right, verify the final result, and note what (if',
    '   anything) is actually wrong.',
    '2. In "issues", list ONLY the confirmed defects found in that check.',
    '',
    'Rules for the issues list — follow them exactly:',
    '- Do NOT assign a grade; we derive it from your issues.',
    '- An issue is a DEFECT: something the student got wrong. If a step is correct,',
    '  it is NOT an issue. Never add an issue whose description concludes the work is',
    '  fine, correct, or "not wrong" — if it is correct, simply omit it.',
    '- Each issue\'s description must state, in one or two sentences, the concrete thing',
    '  that is wrong and why. Do not hedge.',
    '- If the check finds the answer fully correct, return an EMPTY issues list.',
    '- Do not inflate severity. Match the level to the actual defect.',
    '',
    `Formatting (applies to "${CHECK_FIELD}" and every issue "description"): ${LATEX_DELIMITER_INSTRUCTION}`,
    '',
    'Severity levels:',
    '- "critical": the answer is clearly wrong — wrong final result, broken logic, or a',
    '  fundamental misunderstanding of the problem.',
    '- "medium": something is incorrect but it is probably a one-off slip, e.g. an',
    '  arithmetic typo or a sign error, while the approach is otherwise sound.',
    '- "minor": the answer is correct but, for example, uses an unusual (though valid)',
    '  representation, or omits additional non-required context.',
    '',
    `Question:\n${ctx.canonicalText}`,
  ];
  if (ctx.chapterDescription !== undefined && ctx.chapterDescription.trim() !== '') {
    lines.push('', `Chapter context: ${ctx.chapterDescription}`);
  }
  if (ctx.bookLearningGoal !== undefined && ctx.bookLearningGoal.trim() !== '') {
    lines.push('', `Book learning goal: ${ctx.bookLearningGoal}`);
  }
  return lines.join('\n');
}

/**
 * Structured-output schema: a check of the student's working followed by a list of
 * severity-tagged issues (empty = correct). The check comes first so the defects are
 * drawn from it.
 */
export const gradingTurnSchema = {
  type: 'object',
  properties: {
    [CHECK_FIELD]: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'medium', 'minor'] },
          description: { type: 'string' },
        },
        required: ['severity', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: [CHECK_FIELD, 'issues'],
  additionalProperties: false,
} as const;
