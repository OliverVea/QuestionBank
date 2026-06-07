import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  type ExtractedQuestion,
  type ExtractionRequest,
  LlmError,
  type LlmProvider,
} from './provider.js';

const execFileAsync = promisify(execFile);

/** Hard cap on a single CLI extraction. A hung `claude` (auth prompt, wedged
 *  subprocess, network stall) must reject so the route returns 502 rather than
 *  hanging the request indefinitely. */
const CLI_TIMEOUT_MS = 120_000;

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
      await writeFile(schemaPath, JSON.stringify(req.schema), 'utf8');
      const prompt = `${req.prompt}\n\nThe page image is at: ${req.imagePath}\nRead it and extract the questions.`;
      let stdout: string;
      try {
        // NOTE (Windows): execFile (no shell) resolves `claude.exe` via PATHEXT but not a
        // `claude.cmd`/`.ps1` npm shim — a shim-based install throws ENOENT here, which the
        // catch below turns into a clean LlmError→502. The server machine must expose
        // `claude` as a real executable on PATH. We deliberately avoid `shell: true` so the
        // arbitrary-text prompt/path args cannot be misinterpreted by a shell.
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
          { maxBuffer: 16 * 1024 * 1024, timeout: CLI_TIMEOUT_MS },
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
