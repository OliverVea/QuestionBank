import { extractionPrompt, extractionSchema, extractionSchemaWithRelevance, relevanceInstruction } from './extraction-contract.js';
import type { ImageRef } from './image-ref.js';
import { LlmError, type ExtractedQuestion, type LlmProvider } from './provider.js';

const VALID_RELEVANCE = new Set(['high', 'medium', 'low']);

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
  if (typeof obj.relevance === 'string' && VALID_RELEVANCE.has(obj.relevance)) {
    question.relevance = obj.relevance as 'high' | 'medium' | 'low';
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
 *
 * When `learningGoal` is provided, the LLM also scores each question's relevance.
 */
export async function extractQuestions(
  provider: LlmProvider,
  image: ImageRef,
  learningGoal?: string,
): Promise<ExtractedQuestion[]> {
  const prompt = learningGoal
    ? extractionPrompt + relevanceInstruction(learningGoal)
    : extractionPrompt;
  const schema = learningGoal ? extractionSchemaWithRelevance : extractionSchema;

  const envelopeSchema = {
    type: 'object',
    properties: { questions: schema },
    required: ['questions'],
    additionalProperties: false,
  } as const;

  const result = await provider.completeStructured<unknown>(
    [{ role: 'user', text: prompt, images: [image] }],
    envelopeSchema,
  );
  return parseExtractionResult(result);
}
