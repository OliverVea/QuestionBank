/** Context the grader is given about the question being answered. */
export interface GradingContext {
  canonicalText: string;
  chapterDescription?: string;
  bookLearningGoal?: string;
}

/**
 * System-framing prompt for a grading conversation. Sent as the first `user` message
 * ahead of the live transcript; the schema forces a recommended grade on every turn.
 */
export function buildGradingPrompt(ctx: GradingContext): string {
  const lines = [
    'You are grading a student\'s answer to ONE specific titled question.',
    'Grade only this single question. Do not solve other problems, wander to adjacent',
    'exercises, or introduce material beyond what is needed to judge THIS answer.',
    'React to the student\'s answer. Do not independently produce a full worked solution.',
    'Every turn, return critiqueText plus a recommendedGrade of "correct", "partial",',
    'or "incorrect". "partial" means the answer is at least 70% of the way there.',
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

/** Structured-output schema forcing critique text + a recommended grade per turn. */
export const gradingTurnSchema = {
  type: 'object',
  properties: {
    critiqueText: { type: 'string' },
    recommendedGrade: { type: 'string', enum: ['correct', 'partial', 'incorrect'] },
  },
  required: ['critiqueText', 'recommendedGrade'],
  additionalProperties: false,
} as const;
