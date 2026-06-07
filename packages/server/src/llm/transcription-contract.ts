/**
 * The transcribe-ONLY contract for handwritten answer photos. The agent's single job
 * is to transcribe the working exactly as written — never to solve, correct, complete,
 * or grade it. (Otherwise grading would judge the agent's correction, not the student's
 * work.) The question text is supplied as REFERENCE ONLY, to disambiguate handwriting.
 */
export function buildTranscriptionPrompt(questionText: string): string {
  return [
    'You are transcribing a student\'s handwritten working from one or more photos.',
    'Your ONLY job is to transcribe what is written into LaTeX/markdown, EXACTLY as written.',
    'Do NOT solve the problem. Do NOT correct mistakes. Do NOT complete unfinished steps.',
    'Do NOT comment or grade. If the working is wrong or incomplete, transcribe it wrong/incomplete — faithfully reproduce exactly what the student actually wrote.',
    'Preserve mathematical notation exactly using LaTeX.',
    'Combine all photos into a single transcription block (they are pages of one answer).',
    '',
    'The question below is provided as REFERENCE ONLY, to help you read unclear handwriting.',
    'It is NOT something to answer, solve, or steer the transcription toward.',
    '',
    `Question (reference only):\n${questionText}`,
  ].join('\n');
}

/** Structured-output schema: a single combined transcription block. */
export const transcriptionSchema = {
  type: 'object',
  properties: { transcription: { type: 'string' } },
  required: ['transcription'],
  additionalProperties: false,
} as const;
