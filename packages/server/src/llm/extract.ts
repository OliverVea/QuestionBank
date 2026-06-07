import { extractionPrompt, extractionSchema } from './extraction-contract.js';
import type { ImageRef } from './image-ref.js';
import { LlmError, type ExtractedQuestion, type LlmProvider } from './provider.js';

/** Structured-output schema for extraction: a top-level object wrapping the array. */
const extractionEnvelopeSchema = {
  type: 'object',
  properties: { questions: extractionSchema },
  required: ['questions'],
  additionalProperties: false,
} as const;

/** Validate one raw item into an ExtractedQuestion (label omitted when absent/blank). */
function toExtractedQuestion(raw: unknown): ExtractedQuestion {
  if (typeof raw !== 'object' || raw === null) {
    throw new LlmError('extraction item is not an object');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.canonicalText !== 'string' || obj.canonicalText.trim() === '') {
    throw new LlmError('extraction item missing canonicalText');
  }
  const question: ExtractedQuestion = { canonicalText: obj.canonicalText };
  if (typeof obj.label === 'string' && obj.label.trim() !== '') {
    question.label = obj.label;
  }
  return question;
}

/** Validate the parsed `{ questions: [...] }` envelope into ExtractedQuestion[]. */
export function parseExtractionResult(raw: unknown): ExtractedQuestion[] {
  if (typeof raw !== 'object' || raw === null) {
    throw new LlmError('extraction result is not an object');
  }
  const { questions } = raw as Record<string, unknown>;
  if (!Array.isArray(questions)) {
    throw new LlmError('extraction result has no questions array');
  }
  return questions.map(toExtractedQuestion);
}

/**
 * Extract questions from a single image via the conversational interface: one user
 * message carrying the image + the central extraction prompt, completed against the
 * extraction schema, then validated. Provider-agnostic.
 */
export async function extractQuestions(
  provider: LlmProvider,
  image: ImageRef,
): Promise<ExtractedQuestion[]> {
  const result = await provider.completeStructured<unknown>(
    [{ role: 'user', text: extractionPrompt, images: [image] }],
    extractionEnvelopeSchema,
  );
  return parseExtractionResult(result);
}
