/**
 * The provider-agnostic "what to ask" for image question extraction. The prompt
 * and schema live here (the application layer), not in any provider, so a future
 * CLI→API swap does not duplicate or drift them. A provider may augment the prompt
 * with backend-specific framing (e.g. the concrete image path) but must not change
 * the extraction intent.
 */
export const extractionPrompt = [
  'You are extracting questions from a single photographed page of a textbook.',
  'Identify each DISTINCT question or exercise on the page.',
  'For each one, transcribe it faithfully into LaTeX/markdown as `canonicalText`.',
  'If the book shows its own numbering for a question (e.g. "2.4"), put it in `label`; otherwise omit `label`.',
  'Do NOT solve, answer, hint at, or comment on any question. Transcribe only.',
  'Preserve mathematical notation exactly using LaTeX. Do not invent questions that are not on the page.',
  'Return the questions as a JSON array matching the provided schema.',
].join('\n');

/** JSON Schema for the extraction result: an array of ExtractedQuestion. */
export const extractionSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      canonicalText: { type: 'string' },
      label: { type: 'string' },
    },
    required: ['canonicalText'],
    additionalProperties: false,
  },
} as const;
