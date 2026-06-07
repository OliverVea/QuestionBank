/** One question extracted from a source, in the canonical LaTeX/markdown form. */
export interface ExtractedQuestion {
  /** LaTeX/markdown — source of truth. */
  canonicalText: string;
  /** Book's own numbering, e.g. "2.4", if the source showed it. */
  label?: string;
}

/** Everything a provider needs to extract questions from one image. */
export interface ExtractionRequest {
  /** Absolute path to the stored image on the server machine. */
  imagePath: string;
  /** Prompt authored centrally (see extraction-contract.ts) and passed in. */
  prompt: string;
  /** JSON Schema describing an ExtractedQuestion[], passed in. */
  schema: object;
}

/** The LLM layer's single operation for this build. Generalized later (grading). */
export interface LlmProvider {
  extractQuestionsFromImage(req: ExtractionRequest): Promise<ExtractedQuestion[]>;
}

/** Raised by a provider on backend failure (non-zero exit, bad/invalid output). */
export class LlmError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LlmError';
  }
}
