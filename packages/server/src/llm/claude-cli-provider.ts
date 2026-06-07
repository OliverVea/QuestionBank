import type { ExtractedQuestion, ExtractionRequest, LlmProvider } from './provider.js';

/** Real Claude Code CLI backend — implemented in Task 4. */
export class ClaudeCliProvider implements LlmProvider {
  constructor(private readonly imagesDir: string) {}

  extractQuestionsFromImage(_req: ExtractionRequest): Promise<ExtractedQuestion[]> {
    void this.imagesDir;
    throw new Error('ClaudeCliProvider not implemented yet');
  }
}
