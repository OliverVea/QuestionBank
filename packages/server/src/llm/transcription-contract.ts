import { LATEX_DELIMITER_INSTRUCTION } from './latex-format.js';

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
    `Preserve mathematical notation exactly. ${LATEX_DELIMITER_INSTRUCTION}`,
    'Combine all photos into a single transcription block (they are pages of one answer).',
    '',
    'The question below is provided as REFERENCE ONLY, to help you read unclear handwriting.',
    'It is NOT something to answer, solve, or steer the transcription toward.',
    '',
    `Question (reference only):\n${questionText}`,
  ].join('\n');
}

/**
 * Prompt for a correction retranscription. Provides the current transcription and the
 * user's plain-English correction note so the LLM knows exactly what to fix without
 * being anchored to its own prior reasoning.
 */
export function buildRetranscriptionPrompt(
  questionText: string,
  currentTranscription: string,
  correctionNote: string,
): string {
  return [
    'You are retranscribing a student\'s handwritten working from one or more photos.',
    'Your ONLY job is to transcribe what is written into LaTeX/markdown, EXACTLY as written.',
    'Do NOT solve the problem. Do NOT correct mistakes. Do NOT complete unfinished steps.',
    'Do NOT comment or grade. If the working is wrong or incomplete, transcribe it wrong/incomplete.',
    `Preserve mathematical notation exactly. ${LATEX_DELIMITER_INSTRUCTION}`,
    'Combine all photos into a single transcription block.',
    '',
    'The question below is provided as REFERENCE ONLY, to help you read unclear handwriting.',
    '',
    `Question (reference only):\n${questionText}`,
    '',
    'A previous transcription attempt was made. The user has indicated it contains an error.',
    `Previous transcription:\n${currentTranscription}`,
    '',
    `User correction note: ${correctionNote}`,
    '',
    'Please retranscribe from the photos, taking the correction note into account.',
  ].join('\n');
}

/** Structured-output schema: a single combined transcription block. */
export const transcriptionSchema = {
  type: 'object',
  properties: { transcription: { type: 'string' } },
  required: ['transcription'],
  additionalProperties: false,
} as const;
