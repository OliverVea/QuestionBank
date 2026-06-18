import Anthropic from '@anthropic-ai/sdk';
import { describeError, errorCode, log } from '../logging/logger.js';
import {
  type CompleteOpts,
  type ConnectivityResult,
  LlmError,
  type LlmProvider,
  type Message,
} from './provider.js';

/** Hard cap on a single request. Without this the SDK's 10-minute default (retried
 *  up to 2×) could hang the HTTP request for tens of minutes; a timeout → 502. */
const REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** The connectivity probe fails fast and never retries — a health check must not hang
 *  for two minutes or retry through an outage. */
const PROBE_TIMEOUT_MS = 5_000;

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

/** Common stop-reason guards shared by the text and tool-use readers. */
function assertUsableStop(message: Anthropic.Message): void {
  if (message.stop_reason === 'refusal') throw new LlmError('request refused');
  if (message.stop_reason === 'max_tokens') {
    throw new LlmError('response truncated — increase max_tokens');
  }
}

/** Pull the first text block out of a response, or fail fast on refusal/truncation. */
function textFromMessage(message: Anthropic.Message): string {
  assertUsableStop(message);
  const textBlock = message.content.find((block) => block.type === 'text');
  if (textBlock === undefined) throw new LlmError('no text content in API response');
  return textBlock.text;
}

/** Pull the forced tool_use block's input — the structured result — out of a response. */
function toolInputFromMessage<T>(message: Anthropic.Message): T {
  assertUsableStop(message);
  const toolBlock = message.content.find((block) => block.type === 'tool_use');
  if (toolBlock === undefined) throw new LlmError('no tool_use block in API response');
  return toolBlock.input as T;
}

/** The single tool we force the model into for structured output. */
const RESULT_TOOL_NAME = 'result';

/** Direct Anthropic API backend. The client is injectable for testing. */
export class AnthropicApiProvider implements LlmProvider {
  constructor(private readonly client: Anthropic = new Anthropic()) {}

  /**
   * Send one request and return the raw response. Logs the model, message/image counts,
   * timing, and — on failure — the underlying SDK error (status, type, message), which
   * is otherwise hidden behind the generic LlmError. `label` distinguishes call sites
   * in the logs (e.g. "complete" vs "completeStructured"). `extra` carries optional
   * tool/tool_choice for the structured path.
   */
  private async request(
    label: string,
    conversation: Message[],
    extra: Partial<Anthropic.MessageCreateParamsNonStreaming>,
    opts?: CompleteOpts,
  ): Promise<Anthropic.Message> {
    const messages = await toApiMessages(conversation);
    const model = opts?.model ?? DEFAULT_MODEL;
    const imageCount = conversation.reduce((n, m) => n + (m.images?.length ?? 0), 0);
    log.debug(`llm ${label} request`, { model, turns: messages.length, images: imageCount });

    const start = process.hrtime.bigint();
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(
        { model, max_tokens: 8000, messages, ...extra },
        { timeout: opts?.timeoutMs ?? REQUEST_TIMEOUT_MS, maxRetries: 2 },
      );
    } catch (err) {
      const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
      // Surface the real cause. SDK errors carry .status and .name (e.g. 400
      // BadRequestError "unknown field"), which the bare LlmError ate. Transport
      // failures carry no status — the discriminator is a system error `code` buried
      // a few causes deep (APIConnectionError "Connection error." → "fetch failed" →
      // { code: "ETIMEDOUT" }), so log that too: "Connection error." alone never said
      // whether egress was down, DNS failed, or the connection was refused.
      const sdkStatus = (err as { status?: number }).status;
      log.error(`llm ${label} request failed`, {
        model,
        ms,
        status: sdkStatus,
        code: errorCode(err),
        error: describeError(err).message,
      });
      throw new LlmError('anthropic API request failed', { cause: err });
    }

    const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
    log.debug(`llm ${label} response`, { ms, stop: message.stop_reason ?? undefined });
    return message;
  }

  async complete(conversation: Message[], opts?: CompleteOpts): Promise<string> {
    const message = await this.request('complete', conversation, {}, opts);
    return textFromMessage(message);
  }

  async completeStructured<T>(
    conversation: Message[],
    schema: object,
    opts?: CompleteOpts,
  ): Promise<T> {
    // Force a single tool call whose input matches the schema. This is the reliable
    // structured-output path: the model returns a tool_use block with validated input,
    // not free-form prose we have to parse (and fail to parse) out of a text block.
    const message = await this.request(
      'completeStructured',
      conversation,
      {
        tools: [
          { name: RESULT_TOOL_NAME, input_schema: schema as Anthropic.Tool.InputSchema },
        ],
        tool_choice: { type: 'tool', name: RESULT_TOOL_NAME },
      },
      opts,
    );
    return toolInputFromMessage<T>(message);
  }

  /**
   * Probe the API with a metadata read (GET /v1/models) — no tokens billed. It runs through
   * the same client as the real calls, so it exercises the exact auth, base URL, and egress
   * path extraction depends on. Classifies the failure so the caller can explain what's wrong.
   */
  async checkConnectivity(): Promise<ConnectivityResult> {
    const start = process.hrtime.bigint();
    const elapsed = () => Math.round(Number(process.hrtime.bigint() - start) / 1e6);
    try {
      // timeout/maxRetries are RequestOptions (2nd arg), the same shape used by
      // messages.create above. A single page (limit:1) is all we need to prove reachability.
      await this.client.models.list({ limit: 1 }, { timeout: PROBE_TIMEOUT_MS, maxRetries: 0 });
      return { status: 'ok', detail: 'reachable; credentials accepted', ms: elapsed() };
    } catch (err) {
      const ms = elapsed();
      // Egress works but the key is bad — distinct from "can't reach the API at all".
      if (err instanceof Anthropic.AuthenticationError) {
        return {
          status: 'auth',
          detail: 'reachable, but the API key was rejected (401) — check ANTHROPIC_API_KEY',
          httpStatus: 401,
          ms,
        };
      }
      // The request never landed: DNS/TCP/TLS failure or timeout. This is today's outage.
      if (err instanceof Anthropic.APIConnectionError) {
        const code = errorCode(err);
        return {
          status: 'down',
          detail: code
            ? `cannot reach api.anthropic.com (${code}) — pod egress is down or blocked`
            : 'cannot reach api.anthropic.com — pod egress is down or blocked',
          ...(code !== undefined ? { code } : {}),
          ms,
        };
      }
      // Reached the API, got some other error (rate limit, 5xx, bad request).
      const httpStatus = (err as { status?: number }).status;
      return {
        status: 'error',
        detail: `unexpected API error: ${describeError(err).message}`,
        ...(httpStatus !== undefined ? { httpStatus } : {}),
        ms,
      };
    }
  }
}
