import type { CompleteOpts, LlmProvider, Message } from './provider.js';

export interface FakeProviderConfig {
  /** Text returned by every `complete` call. */
  completeText?: string;
  /** Object returned by every `completeStructured` call. */
  structured?: unknown;
}

/**
 * Deterministic, configurable provider for tests — never hits the network. Returns
 * fixed values; records the last conversation; `failWith()` makes the next call throw.
 */
export class FakeProvider implements LlmProvider {
  private error: Error | undefined;
  /** The conversation passed to the most recent complete/completeStructured call. */
  lastConversation: Message[] = [];

  constructor(private readonly config: FakeProviderConfig = {}) {}

  /** Make the next call reject with this error (simulates backend failure). */
  failWith(error: Error): void {
    this.error = error;
  }

  async complete(conversation: Message[], _opts?: CompleteOpts): Promise<string> {
    this.lastConversation = conversation;
    if (this.error) throw this.error;
    return this.config.completeText ?? 'fake completion';
  }

  async completeStructured<T>(
    conversation: Message[],
    _schema: object,
    _opts?: CompleteOpts,
  ): Promise<T> {
    this.lastConversation = conversation;
    if (this.error) throw this.error;
    if (this.config.structured === undefined) {
      // Default to an empty extraction envelope so the refactored extraction path
      // has a usable shape when a test doesn't configure one.
      return { questions: [] } as T;
    }
    return this.config.structured as T;
  }
}
