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
  'ALWAYS provide a referenceable `label` for every question. Prefer a real label drawn',
  'from any signal on the page: the question\'s own visible number, "Problem N" / "Exercise N"',
  'phrasing, section or chapter numbers, or a page header/footer (top or bottom of the page).',
  'Only when no real label can be found, fall back to a position-based label: an ordinal',
  'within this batch ("#1", "#2", …), or "p.<page>-<n>" when a page number is visible.',
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
