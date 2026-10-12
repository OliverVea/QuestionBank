import { LlmError } from '../llm/provider.js';
import type { CompleteOpts, ConnectivityResult, LlmProvider, Message } from '../llm/provider.js';

/**
 * The demo's model backend: there is none. The demo pod holds no API key, so nothing a
 * visitor does can bill; every model call fails with a message the client can show.
 */
export class DemoProvider implements LlmProvider {
  async complete(_conversation: Message[], _opts?: CompleteOpts): Promise<string> {
    throw new LlmError('model calls are switched off in the demo');
  }

  async completeStructured<T>(
    _conversation: Message[],
    _schema: object,
    _opts?: CompleteOpts,
  ): Promise<T> {
    throw new LlmError('model calls are switched off in the demo');
  }

  async checkConnectivity(): Promise<ConnectivityResult> {
    return { status: 'ok', detail: 'demo mode: no model backend', ms: 0 };
  }
}
