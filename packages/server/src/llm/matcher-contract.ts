import type { ImageRef } from './image-ref.js';
import { LlmError, type LlmProvider, type Message } from './provider.js';

/**
 * The figure→problem matcher: a conditional Claude Haiku 4.5 call (the bare alias the
 * spike proved at 41/42) over the rectified page(s) + figure crops + the candidate `add`
 * problems. Returns, per figure, the caption it reads off the page and the problem INDEX
 * it belongs to. Indices — not labels — are the join key (labels repeat under one path).
 */

/** Bare alias matching the spike + the provider's alias convention. Haiku rejects `effort`. */
const MATCHER_MODEL = 'claude-haiku-4-5';

/** One small entry per figure — far below the 8000 default; truncation → matchError. */
const MATCHER_MAX_TOKENS = 4000;

/** A candidate `add` problem the matcher may assign figures to (presented by index). */
export interface MatchCandidate {
  /** Display label (e.g. "5.32") — shown to the model for context, never matched on. */
  label: string;
  /** The figure captions this problem cites. */
  figureRefs: string[];
}

export interface FigureMatch {
  /** 0-based index into the crops sent, in reading order. */
  figureIndex: number;
  /** Caption read off the page ("" if none visible). */
  printedLabel: string;
  /** Index into the candidate `add` list, or null when it belongs to none. */
  matchedProblemIndex: number | null;
  /** Enum (matches the spike + Figure.confidence) — never a 0–1 number. */
  confidence: 'high' | 'medium' | 'low';
}

export interface MatchResult {
  matches: FigureMatch[];
}

const CONFIDENCE = new Set(['high', 'medium', 'low']);

/**
 * Build the matcher's single text block. Problems are referenced by INDEX (labels can
 * repeat under one path, so they aren't unique). `pageCount` and `figureCount` tell the
 * model how the prepended images are split (pages first, then crops in reading order).
 */
export function buildMatcherPrompt(
  candidates: MatchCandidate[],
  figureCount: number,
  pageCount: number,
): string {
  const problemLines = candidates.map(
    (c, i) => `  ${i}: ${c.label} — [${c.figureRefs.join(', ')}]`,
  );
  return [
    'You are matching detected FIGURES to PROBLEMS on textbook page(s).',
    `IMAGES: the first ${pageCount} image(s) are the rectified page(s). The next ${figureCount}`,
    'image(s) are the figure crops, in reading order, indices 0..N-1.',
    '',
    'PROBLEMS (index: label — cites figures):',
    ...problemLines,
    '',
    `FIGURES: there are ${figureCount} crops, indices 0..${figureCount - 1}. For each figure,`,
    'read its printed caption off the PAGE image and assign it to the ONE problem INDEX it',
    `belongs to (0..${candidates.length - 1}), or null if it belongs to none of the listed`,
    'problems. Always answer with the INDEX, never the label (labels may repeat). Reading',
    'order is the tiebreaker for unlabeled or split (a)/(b) panels. Do not output coordinates.',
  ].join('\n');
}

/** JSON schema for the forced structured-output tool. */
export const matcherSchema = {
  type: 'object',
  required: ['matches'],
  additionalProperties: false,
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        required: ['figureIndex', 'printedLabel', 'matchedProblemIndex', 'confidence'],
        additionalProperties: false,
        properties: {
          figureIndex: { type: 'integer' },
          printedLabel: { type: 'string' },
          matchedProblemIndex: { type: ['integer', 'null'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
} as const;

/**
 * Validate raw matcher output into a typed MatchResult. `figureCount` = N (crops sent);
 * `candidateCount` = M (the `add` candidate list length — NOT resolved.length). Entries
 * with an out-of-range figureIndex, an out-of-range matchedProblemIndex, or a bad
 * confidence are dropped (unlisted/garbled figures simply stay unmatched). Throws only
 * when the envelope shape itself is wrong.
 */
export function validateMatchResult(
  raw: unknown,
  figureCount: number,
  candidateCount: number,
): MatchResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new LlmError('matcher result is not an object');
  }
  const rawMatches = (raw as Record<string, unknown>).matches;
  if (!Array.isArray(rawMatches)) throw new LlmError('matcher result has no matches array');

  const matches: FigureMatch[] = [];
  for (const m of rawMatches) {
    if (typeof m !== 'object' || m === null) continue;
    const item = m as Record<string, unknown>;
    const figureIndex = item.figureIndex;
    if (typeof figureIndex !== 'number' || !Number.isInteger(figureIndex)) continue;
    if (figureIndex < 0 || figureIndex >= figureCount) continue;
    if (typeof item.confidence !== 'string' || !CONFIDENCE.has(item.confidence)) continue;

    let matchedProblemIndex: number | null = null;
    const mpi = item.matchedProblemIndex;
    if (typeof mpi === 'number' && Number.isInteger(mpi)) {
      // Out-of-range index → treat as unmatched rather than dropping the whole entry.
      matchedProblemIndex = mpi >= 0 && mpi < candidateCount ? mpi : null;
    }

    matches.push({
      figureIndex,
      printedLabel: typeof item.printedLabel === 'string' ? item.printedLabel : '',
      matchedProblemIndex,
      confidence: item.confidence as 'high' | 'medium' | 'low',
    });
  }
  return { matches };
}

export interface RunMatcherInput {
  /** Rectified page image(s), in page order. */
  pageImages: ImageRef[];
  /** Figure crops, in detector reading order (index = figureIndex). */
  cropImages: ImageRef[];
  /** Candidate `add` problems, presented by index. */
  candidates: MatchCandidate[];
}

/**
 * Run the matcher. Sends one user turn: images = [pages…, crops…] + the text block. Uses
 * Haiku with an explicit maxTokens (no `effort`/thinking — Haiku rejects them). Throws
 * LlmError on backend/validation failure; the route catches it as best-effort (matchError).
 */
export async function runMatcher(
  provider: LlmProvider,
  input: RunMatcherInput,
): Promise<MatchResult> {
  const { pageImages, cropImages, candidates } = input;
  const text = buildMatcherPrompt(candidates, cropImages.length, pageImages.length);
  const messages: Message[] = [
    { role: 'user', text, images: [...pageImages, ...cropImages] },
  ];
  const raw = await provider.completeStructured<unknown>(messages, matcherSchema, {
    model: MATCHER_MODEL,
    maxTokens: MATCHER_MAX_TOKENS,
    tag: 'figure-matching',
  });
  return validateMatchResult(raw, cropImages.length, candidates.length);
}
