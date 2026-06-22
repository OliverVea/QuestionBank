import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { describeError, errorCode, log } from '../logging/logger.js';
import {
  type CompleteOpts,
  type ConnectivityResult,
  LlmError,
  type LlmProvider,
  type Message,
} from './provider.js';

/** Hard cap on a single request. Without this the SDK's 10-minute default could hang the
 *  HTTP request for tens of minutes; a timeout → 502. Call sites whose payload runs long
 *  (transcription, grading) raise it via `timeoutMs`. */
const REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Default output-token ceiling for a request. Call sites whose structured response can
 *  run long pass a higher `maxTokens` (truncation here surfaces as a 502 to the user). */
const DEFAULT_MAX_TOKENS = 8000;

/** The connectivity probe fails fast and never retries — a health check must not hang
 *  for two minutes or retry through an outage. */
const PROBE_TIMEOUT_MS = 5_000;

/** App-level retry: the SDK's own retry is disabled (maxRetries: 0) so we can log every
 *  attempt — a retry means a transient backend failure that "should not be necessary", so
 *  it is worth surfacing. Capped at 2 retries with exponential backoff. */
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry only transient failures: retryable HTTP statuses, or a transport error that carries
 *  a system error code (ETIMEDOUT/ECONNRESET/ENOTFOUND…). An unclassifiable throw (no status,
 *  no code) is treated as permanent — retrying it just delays the inevitable 502. */
function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  if (status !== undefined) {
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }
  return errorCode(err) !== undefined;
}

/** Resolution of one image sent to the model, captured for the audit log. */
interface ImageAudit {
  width?: number;
  height?: number;
}

/** Build the Anthropic content blocks for one Message (images first, then text). Appends
 *  one {@link ImageAudit} per image to `audit` (best-effort dimensions for the audit log). */
async function toApiContent(
  message: Message,
  audit: ImageAudit[],
): Promise<Anthropic.ContentBlockParam[]> {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const image of message.images ?? []) {
    const bytes = await image.load();
    let dims: ImageAudit = {};
    try {
      const meta = await sharp(bytes).metadata();
      dims = { width: meta.width, height: meta.height };
    } catch {
      // Audit is best-effort — a header sharp can't parse must not fail the LLM call.
    }
    audit.push(dims);
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mimeType, data: bytes.toString('base64') },
    });
  }
  blocks.push({ type: 'text', text: message.text });
  return blocks;
}

async function toApiMessages(
  conversation: Message[],
  audit: ImageAudit[],
): Promise<Anthropic.MessageParam[]> {
  return Promise.all(
    conversation.map(async (m) => ({ role: m.role, content: await toApiContent(m, audit) })),
  );
}

/** Common stop-reason guards shared by the text and tool-use readers. These throws end
 *  in a 502, so they MUST log their cause — the SDK call succeeded, so the HTTP-failure
 *  path never fired, and a bare LlmError otherwise leaves prod with no reason for the 502.
 *  `max_tokens` in particular means the response overran the output ceiling — raise the
 *  call site's `maxTokens` (the output_tokens here is the ceiling that was hit). */
function assertUsableStop(message: Anthropic.Message): void {
  if (message.stop_reason === 'refusal') {
    log.warn('llm response refused', { model: message.model, stop: message.stop_reason });
    throw new LlmError('request refused');
  }
  if (message.stop_reason === 'max_tokens') {
    log.warn('llm response truncated — raise maxTokens', {
      model: message.model,
      stop: message.stop_reason,
      outputTokens: message.usage.output_tokens,
    });
    throw new LlmError('response truncated — increase max_tokens');
  }
}

/** Pull the first text block out of a response, or fail fast on refusal/truncation. */
function textFromMessage(message: Anthropic.Message): string {
  assertUsableStop(message);
  const textBlock = message.content.find((block) => block.type === 'text');
  if (textBlock === undefined) {
    log.warn('llm response missing text block', { model: message.model, stop: message.stop_reason });
    throw new LlmError('no text content in API response');
  }
  return textBlock.text;
}

/** Pull the forced tool_use block's input — the structured result — out of a response. */
function toolInputFromMessage<T>(message: Anthropic.Message): T {
  assertUsableStop(message);
  const toolBlock = message.content.find((block) => block.type === 'tool_use');
  if (toolBlock === undefined) {
    log.warn('llm response missing tool_use block', {
      model: message.model,
      stop: message.stop_reason,
    });
    throw new LlmError('no tool_use block in API response');
  }
  return toolBlock.input as T;
}

/** The single tool we force the model into for structured output. */
const RESULT_TOOL_NAME = 'result';

/** Direct Anthropic API backend. The client is injectable for testing. */
export class AnthropicApiProvider implements LlmProvider {
  constructor(private readonly client: Anthropic = new Anthropic()) {}

  /**
   * Send one request and return the raw response. Retries transient failures itself (the
   * SDK's own retry is off so each attempt is logged), emits a per-call audit line (tokens,
   * model, effort, image count + resolutions, tag) on success, and on terminal failure logs
   * the underlying SDK error (status, code, message) that the bare LlmError would otherwise
   * hide. `label` distinguishes the provider method; `opts.tag` names the call's purpose for
   * the audit log. `extra` carries optional tool/tool_choice for the structured path.
   */
  private async request(
    label: string,
    conversation: Message[],
    extra: Partial<Anthropic.MessageCreateParamsNonStreaming>,
    opts?: CompleteOpts,
  ): Promise<Anthropic.Message> {
    const imageAudit: ImageAudit[] = [];
    const messages = await toApiMessages(conversation, imageAudit);
    const model = opts?.model ?? DEFAULT_MODEL;
    const tag = opts?.tag ?? label;
    log.debug(`llm ${label} request`, { model, turns: messages.length, images: imageAudit.length });

    // `output_config.effort` is GA (no beta header) on Sonnet 4.6 / Opus-tier; Haiku rejects
    // it, so only send it when a call site opted in. Cast: the SDK type may lag the GA param.
    const params = {
      model,
      max_tokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
      ...extra,
      ...(opts?.effort ? { output_config: { effort: opts.effort } } : {}),
    } as Anthropic.MessageCreateParamsNonStreaming;

    const start = process.hrtime.bigint();
    for (let attempt = 0; ; attempt++) {
      try {
        const message = await this.client.messages.create(params, {
          timeout: opts?.timeoutMs ?? REQUEST_TIMEOUT_MS,
          maxRetries: 0,
        });
        const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
        // Per-call audit line for cost/usage review. usage is absent in some test doubles.
        log.info('llm audit', {
          tag,
          model,
          effort: opts?.effort,
          inputTokens: message.usage?.input_tokens,
          outputTokens: message.usage?.output_tokens,
          cacheReadTokens: message.usage?.cache_read_input_tokens,
          cacheCreateTokens: message.usage?.cache_creation_input_tokens,
          images: imageAudit.length,
          resolutions: imageAudit.map((i) =>
            i.width && i.height ? `${i.width}x${i.height}` : 'unknown',
          ),
          ms,
        });
        return message;
      } catch (err) {
        const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
        const sdkStatus = (err as { status?: number }).status;
        // A retry means a transient backend failure that should not be necessary — log it.
        if (attempt < MAX_RETRIES && isRetryable(err)) {
          log.warn(`llm ${tag} retry`, {
            attempt: attempt + 1,
            model,
            ms,
            status: sdkStatus,
            code: errorCode(err),
            error: describeError(err).message,
          });
          await sleep(RETRY_BASE_MS * 2 ** attempt);
          continue;
        }
        // Terminal. Surface the real cause — SDK errors carry .status (e.g. 400 "unknown
        // field"); transport failures carry no status but a system error `code` buried a
        // few causes deep (APIConnectionError → "fetch failed" → { code: "ETIMEDOUT" }).
        log.error(`llm ${label} request failed`, {
          model,
          ms,
          status: sdkStatus,
          code: errorCode(err),
          error: describeError(err).message,
        });
        throw new LlmError('anthropic API request failed', { cause: err });
      }
    }
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
