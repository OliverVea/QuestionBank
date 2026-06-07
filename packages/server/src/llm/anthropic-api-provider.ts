import Anthropic from '@anthropic-ai/sdk';
import { type CompleteOpts, LlmError, type LlmProvider, type Message } from './provider.js';

/** Hard cap on a single request. Without this the SDK's 10-minute default (retried
 *  up to 2×) could hang the HTTP request for tens of minutes; a timeout → 502. */
const REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Build the Anthropic content blocks for one Message (images first, then text). */
async function toApiContent(message: Message): Promise<Anthropic.ContentBlockParam[]> {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const image of message.images ?? []) {
    const bytes = await image.load();
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mimeType, data: bytes.toString('base64') },
    });
  }
  blocks.push({ type: 'text', text: message.text });
  return blocks;
}

async function toApiMessages(conversation: Message[]): Promise<Anthropic.MessageParam[]> {
  return Promise.all(
    conversation.map(async (m) => ({ role: m.role, content: await toApiContent(m) })),
  );
}

/** Pull the first text block out of a response, or fail fast on refusal/truncation. */
function textFromMessage(message: Anthropic.Message): string {
  if (message.stop_reason === 'refusal') throw new LlmError('request refused');
  if (message.stop_reason === 'max_tokens') {
    throw new LlmError('response truncated — increase max_tokens');
  }
  const textBlock = message.content.find((block) => block.type === 'text');
  if (textBlock === undefined) throw new LlmError('no text content in API response');
  return textBlock.text;
}

/** Direct Anthropic API backend. The client is injectable for testing. */
export class AnthropicApiProvider implements LlmProvider {
  constructor(private readonly client: Anthropic = new Anthropic()) {}

  async complete(conversation: Message[], opts?: CompleteOpts): Promise<string> {
    const messages = await toApiMessages(conversation);
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(
        { model: opts?.model ?? DEFAULT_MODEL, max_tokens: 8000, messages },
        { timeout: opts?.timeoutMs ?? REQUEST_TIMEOUT_MS, maxRetries: 2 },
      );
    } catch (err) {
      throw new LlmError('anthropic API request failed', { cause: err });
    }
    return textFromMessage(message);
  }

  async completeStructured<T>(
    conversation: Message[],
    schema: object,
    opts?: CompleteOpts,
  ): Promise<T> {
    const messages = await toApiMessages(conversation);
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(
        {
          model: opts?.model ?? DEFAULT_MODEL,
          max_tokens: 8000,
          messages,
          output_config: {
            format: { type: 'json_schema', schema: schema as Record<string, unknown> },
          },
        },
        { timeout: opts?.timeoutMs ?? REQUEST_TIMEOUT_MS, maxRetries: 2 },
      );
    } catch (err) {
      throw new LlmError('anthropic API request failed', { cause: err });
    }
    const text = textFromMessage(message);
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new LlmError('API response was not valid JSON', { cause: err });
    }
  }
}
