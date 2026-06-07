import { LATEX_DELIMITER_INSTRUCTION } from './latex-format.js';

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
 * What the model returns each turn. `reasoning` is a private scratchpad — the model
 * works through the answer there so its chain-of-thought does NOT leak into the issue
 * list. Only confirmed defects belong in `issues`; an empty list means correct.
 */
export interface GradingTurnResult {
  reasoning: string;
  issues: GradingIssue[];
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
 * ahead of the live transcript. The model reasons in a private scratchpad, then reports
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
    'Work in two steps:',
    '1. In "reasoning", think through the answer step by step: check each line of the',
    '   student\'s working, verify the final result, and decide what (if anything) is',
    '   actually wrong. This is your private scratchpad — the student never sees it.',
    '2. In "issues", list ONLY the confirmed defects you found in step 1.',
    '',
    'Rules for the issues list — follow them exactly:',
    '- Do NOT assign a grade; we derive it from your issues.',
    '- An issue is a DEFECT: something the student got wrong. If a step is correct,',
    '  it is NOT an issue. Never add an issue whose description concludes the work is',
    '  fine, correct, or "not wrong" — if it is correct, simply omit it.',
    '- Each issue\'s description must state, in one or two sentences, the concrete thing',
    '  that is wrong and why. Do not narrate your reasoning or hedge.',
    '- If, after reasoning, the answer is fully correct, return an EMPTY issues list.',
    '- Do not inflate severity. Match the level to the actual defect.',
    '',
    `Formatting (applies to "reasoning" and every issue "description"): ${LATEX_DELIMITER_INSTRUCTION}`,
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
 * Structured-output schema: a private reasoning scratchpad followed by a list of
 * severity-tagged issues (empty = correct). `reasoning` is first so the model thinks
 * before it commits to defects; the route strips it before responding to the client.
 */
export const gradingTurnSchema = {
  type: 'object',
  properties: {
    reasoning: { type: 'string' },
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
  required: ['reasoning', 'issues'],
  additionalProperties: false,
} as const;
