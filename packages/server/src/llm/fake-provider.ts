import type { ExtractedQuestion, ExtractionRequest, LlmProvider } from './provider.js';

/**
 * Deterministic, configurable provider for tests — never shells out, hits the
 * network, or needs an authenticated CLI. Construct with a fixed result, or call
 * failWith() to make the next extraction throw.
 */
export class FakeProvider implements LlmProvider {
  private error: Error | undefined;

  constructor(
    private readonly result: ExtractedQuestion[] = [{ canonicalText: 'Sample extracted question.' }],
  ) {}

  /** Make subsequent extractions reject with this error (simulates backend failure). */
  failWith(error: Error): void {
    this.error = error;
  }

  async extractQuestionsFromImage(_req: ExtractionRequest): Promise<ExtractedQuestion[]> {
    if (this.error) throw this.error;
    return this.result.map((q) => ({ ...q }));
  }
}
