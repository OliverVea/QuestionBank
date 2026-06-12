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
}

/** The LLM layer's conversational operations. Stateless: caller replays the transcript. */
export interface LlmProvider {
  /** Free-text completion of a conversation. */
  complete(conversation: Message[], opts?: CompleteOpts): Promise<string>;
  /** Schema-constrained completion; the provider validates/parses against `schema`. */
  completeStructured<T>(conversation: Message[], schema: object, opts?: CompleteOpts): Promise<T>;
}

/** Raised by a provider on backend failure (request failed, bad/invalid output). */
export class LlmError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LlmError';
  }
}
