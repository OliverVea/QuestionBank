import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { extractionSchema } from './extraction-contract.js';
import {
  type ExtractedQuestion,
  type ExtractionRequest,
  LlmError,
  type LlmProvider,
} from './provider.js';

/**
 * SDK structured-output schemas must be a top-level object, so we wrap the
 * contract's array schema under a `questions` property. Adapting the contract
 * to the SDK's expected shape is the provider's job, hence the import here.
 */
const outputSchema = {
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

/**
 * Validate the parsed structured-output object `{ questions: [...] }` into
 * ExtractedQuestion[]. Pure and exported so it can be unit-tested without a
 * network call (mirrors how the CLI provider split out `parseCliEnvelope`).
 */
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

/** The media types the Anthropic base64 image block accepts. */
type ImageMediaType = Anthropic.Base64ImageSource['media_type'];

/** Map a file extension to the media type for an Anthropic image block (case-insensitive). */
export function mediaTypeForPath(imagePath: string): ImageMediaType {
  const ext = extname(imagePath).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      throw new LlmError(`unsupported image type: ${ext || '(none)'}`);
  }
}

/**
 * Direct Anthropic API backend. Reads the stored image by absolute path,
 * sends it to a vision-capable model with a structured-output schema, and
 * validates the parsed result. The client is injectable for testing.
 */
export class AnthropicApiProvider implements LlmProvider {
  private readonly model = 'claude-sonnet-4-6';

  constructor(private readonly client: Anthropic = new Anthropic()) {}

  async extractQuestionsFromImage(req: ExtractionRequest): Promise<ExtractedQuestion[]> {
    let base64: string;
    try {
      const bytes = await readFile(req.imagePath);
      base64 = bytes.toString('base64');
    } catch (err) {
      throw new LlmError('could not read image file', { cause: err });
    }

    const mediaType = mediaTypeForPath(req.imagePath);

    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create({
        model: this.model,
        max_tokens: 8000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text', text: req.prompt },
            ],
          },
        ],
        output_config: { format: { type: 'json_schema', schema: outputSchema } },
      });
    } catch (err) {
      throw new LlmError('anthropic API request failed', { cause: err });
    }

    // These stop reasons mean the structured output will be absent or malformed —
    // fail fast with a descriptive error rather than parsing garbage.
    if (message.stop_reason === 'refusal') {
      throw new LlmError('extraction refused');
    }
    if (message.stop_reason === 'max_tokens') {
      throw new LlmError('extraction truncated — increase max_tokens');
    }

    const textBlock = message.content.find((block) => block.type === 'text');
    if (textBlock === undefined) {
      throw new LlmError('no text content in API response');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch (err) {
      throw new LlmError('API response was not valid JSON', { cause: err });
    }

    return parseExtractionResult(parsed);
  }
}
