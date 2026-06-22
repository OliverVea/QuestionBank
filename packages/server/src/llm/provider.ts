import type { ImageRef } from './image-ref.js';

/** One question extracted from a source, in the canonical LaTeX/markdown form. */
export interface ExtractedQuestion {
  /** LaTeX/markdown — source of truth. */
  canonicalText: string;
  /** Book's own numbering, e.g. "2.4", if the source showed it. */
  label?: string;
  /** Relevance to the book's learning goal (only present when goal was provided). */
  relevance?: 'high' | 'medium' | 'low';
}

export type Role = 'user' | 'assistant';

export interface Message {
  role: Role;
  text: string;
  /** Images carried with this turn (extraction, answer transcription). */
  images?: ImageRef[];
}

/** Provider-specific knobs (model, timeout, …). All optional. */
export interface CompleteOpts {
  model?: string;
  timeoutMs?: number;
  /** Cap on output tokens for this call. Defaults to the provider's own ceiling.
   *  Raise it for call sites whose structured response can be long (e.g. grading,
   *  where a verbose reasoning + issues list truncates and 502s at the default). */
  maxTokens?: number;
  /** Reasoning effort (`output_config.effort`). Supported on Sonnet 4.6 / Opus-tier;
   *  Haiku rejects it, so leave it unset for Haiku call sites. */
  effort?: 'low' | 'medium' | 'high' | 'max';
  /** Purpose tag for the per-call audit log (e.g. 'grading', 'transcription'). Defaults
   *  to the provider method name when unset. */
  tag?: string;
}

/**
 * Outcome of a lightweight reachability probe against the LLM backend.
 *  - `ok`    — the backend answered; egress and credentials are both good.
 *  - `auth`  — the backend answered but rejected the credential (egress is fine, key is bad).
 *  - `down`  — the request never landed (DNS/TCP/TLS failure or timeout); `code` carries the
 *              system error code (e.g. ETIMEDOUT) so the cause is obvious at a glance.
 *  - `error` — the backend answered with some other failure; `status` carries the HTTP code.
 * `detail` is always a one-line human-readable explanation.
 */
export interface ConnectivityResult {
  status: 'ok' | 'auth' | 'down' | 'error';
  detail: string;
  /** System error code for `down` (ETIMEDOUT, ECONNREFUSED, ENOTFOUND, …). */
  code?: string;
  /** HTTP status for `error` (and for `auth`, which is always 401). */
  httpStatus?: number;
  /** Round-trip time of the probe, in milliseconds. */
  ms: number;
}

/** The LLM layer's conversational operations. Stateless: caller replays the transcript. */
export interface LlmProvider {
  /** Free-text completion of a conversation. */
  complete(conversation: Message[], opts?: CompleteOpts): Promise<string>;
  /** Schema-constrained completion; the provider validates/parses against `schema`. */
  completeStructured<T>(conversation: Message[], schema: object, opts?: CompleteOpts): Promise<T>;
  /**
   * Probe backend reachability without spending tokens. Uses the same client (auth, base URL,
   * proxy) as the real calls, so its verdict predicts whether `complete`/`completeStructured`
   * would reach the backend right now. Never throws — failures are returned as a result.
   */
  checkConnectivity(): Promise<ConnectivityResult>;
}

/** Raised by a provider on backend failure (request failed, bad/invalid output). */
export class LlmError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LlmError';
  }
}
