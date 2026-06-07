import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { extractionSchema } from './extraction-contract.js';
import {
  type ExtractedQuestion,
  type ExtractionRequest,
  LlmError,
  type LlmProvider,
} from './provider.js';

const execFileAsync = promisify(execFile);

/** Validate one raw item from the CLI result into an ExtractedQuestion (label omitted when absent). */
function toExtractedQuestion(raw: unknown): ExtractedQuestion {
  if (typeof raw !== 'object' || raw === null) {
    throw new LlmError('extraction item is not an object');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.canonicalText !== 'string' || obj.canonicalText.trim() === '') {
    throw new LlmError('extraction item missing canonicalText');
  }
  const question: ExtractedQuestion = { canonicalText: obj.canonicalText };
  if (typeof obj.label === 'string' && obj.label.trim() !== '') {
    question.label = obj.label;
  }
  return question;
}

/**
 * Parse a `claude -p --output-format json` envelope into ExtractedQuestion[].
 * Exported (and pure) so it can be tested against captured fixtures without shelling out.
 */
export function parseCliEnvelope(stdout: string): ExtractedQuestion[] {
  let envelope: { is_error?: boolean; result?: unknown };
  try {
    envelope = JSON.parse(stdout) as typeof envelope;
  } catch (err) {
    throw new LlmError('CLI output was not valid JSON', { cause: err });
  }
  if (envelope.is_error) {
    throw new LlmError('CLI reported an error result');
  }
  if (typeof envelope.result !== 'string') {
    throw new LlmError('CLI envelope has no string result');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope.result);
  } catch (err) {
    throw new LlmError('CLI result was not valid JSON', { cause: err });
  }
  if (!Array.isArray(parsed)) {
    throw new LlmError('CLI result was not a JSON array');
  }
  return parsed.map(toExtractedQuestion);
}

/**
 * Default backend: shells out to the Claude Code CLI. Uses execFile (no shell) with
 * args as an array. Writes the schema to a temp file for --json-schema, grants read
 * access to the images dir via --add-dir, and augments the central prompt with the
 * concrete image path so the CLI's read tool loads the file.
 */
export class ClaudeCliProvider implements LlmProvider {
  constructor(private readonly imagesDir: string) {}

  async extractQuestionsFromImage(req: ExtractionRequest): Promise<ExtractedQuestion[]> {
    const schemaDir = await mkdtemp(join(tmpdir(), 'qb-schema-'));
    const schemaPath = join(schemaDir, 'schema.json');
    try {
      await writeFile(schemaPath, JSON.stringify(req.schema ?? extractionSchema), 'utf8');
      const prompt = `${req.prompt}\n\nThe page image is at: ${req.imagePath}\nRead it and extract the questions.`;
      let stdout: string;
      try {
        ({ stdout } = await execFileAsync(
          'claude',
          [
            '-p',
            '--output-format',
            'json',
            '--json-schema',
            schemaPath,
            '--add-dir',
            this.imagesDir,
            prompt,
          ],
          { maxBuffer: 16 * 1024 * 1024 },
        ));
      } catch (err) {
        throw new LlmError('claude CLI invocation failed', { cause: err });
      }
      return parseCliEnvelope(stdout);
    } finally {
      await rm(schemaDir, { recursive: true, force: true });
    }
  }
}
