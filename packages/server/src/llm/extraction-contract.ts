import { LATEX_DELIMITER_INSTRUCTION } from './latex-format.js';

/** One existing problem, rendered into the prompt so the model can dedupe/repair. */
export interface ExistingProblem {
  id: string;
  path: string;
  text: string;
}

/**
 * Relevance scoring against the book's learning goal — preserved from the
 * single-page flow. Appended to the prompt only when the book has a goal.
 */
export function relevanceInstruction(learningGoal: string): string {
  return [
    '',
    `The student's learning goal for this book is: "${learningGoal}"`,
    'For each problem in `resolved` (not skips), also set its `relevance` to this goal:',
    '- "high": directly tests or practices the stated goal',
    '- "medium": partially related or builds prerequisite skills',
    '- "low": tangential or unrelated to the goal',
  ].join('\n');
}

/**
 * The provider-agnostic "what to ask" for multi-page question extraction. The prompt
 * and schema live here (the application layer), not in any provider, so a future
 * CLI→API swap does not duplicate or drift them. The prompt is built per-request
 * because it embeds the book's existing problems (and optionally the learning goal).
 */
const PROMPT_HEAD = [
  'You are given one or more photographed pages of a SINGLE book, in reading order.',
  'Identify each DISTINCT question or exercise across the pages.',
  'For each one, transcribe it faithfully into LaTeX/markdown as `canonicalText`.',
  'Do NOT solve, answer, hint at, or comment on any question. Transcribe only.',
  `Preserve mathematical notation exactly. ${LATEX_DELIMITER_INSTRUCTION} Do not invent questions that are not on the pages.`,
  '',
  'SELF-CONTAINED QUESTIONS. Every `canonicalText` must carry enough context to be solved on',
  'its own, without reading any other problem, shared preamble, or worked example. When a',
  'problem leans on shared context — a section or problem-set preamble ("For problems 3-7, let',
  'f(x) = x^2 ..."), a worked example it imitates, a shared figure/table/dataset, or a prior',
  'problem it extends ("repeat the above for g(x)", "now find the derivative") — fold that needed',
  'context INTO this problem\'s `canonicalText` so it stands alone. This restructuring is faithful,',
  'not invention: only pull in context actually present on the pages, and never add, solve, hint',
  'at, or alter the question itself.',
  '',
  'CARRY SECTION CONTEXT FORWARD. If page 1 establishes Chapter 1, Section A and page 2',
  'shows only bare problem numbers that continue the sequence, those belong to "1.A".',
  '',
  'PATH LABELS. Express every label as a dotted path reflecting the book\'s structure:',
  '<chapter>.<section>.<problem>, using whatever levels the book exposes ("1.A.3", "2.4",',
  '"II.3", or a single segment like "Warm-ups" when the book is unstructured). Splitting the',
  'label on "." must reconstruct the grouping the reader sees.',
  '',
  'AMBIGUITY — ASK, DON\'T GUESS. If a page does not give you enough context to build a full',
  'path (bare numbers with no derivable chapter/section and no prior page to continue), DO NOT',
  'invent a prefix. Return those problems under `needsSection` for that page, with their local',
  'labels, so the user can supply the missing section.',
  '',
  'DEDUPE / REPAIR. Below is every problem already in this book as `id | path | text`. For each',
  'problem you extract: if it already exists with equivalent text, return a `skip` referencing',
  'its `id`. If it exists but your transcription corrects an error (OCR, math, typo), return an',
  '`edit` referencing its `id` with the improved `canonicalText`. Otherwise return an `add`.',
  'Treat same-path-but-genuinely-different problems as `add`s (a path may hold several problems).',
  '',
  'REQUIRED FIELDS PER DELTA — every delta MUST carry these or it will be rejected:',
  '- `add`:  `path` + `canonicalText`  (NO `targetId`).',
  '- `edit`: `path` + `canonicalText` + `targetId`. ALWAYS include the `path` — reuse the',
  '  existing problem\'s `path` from the list above (do not omit it, even when only the text changed).',
  '- `skip`: `targetId` only (the `canonicalText` is informational).',
].join('\n');

/** Render the existing-problem block; an empty book yields an explicit "none" line. */
export function renderExistingProblems(existing: ExistingProblem[]): string {
  if (existing.length === 0) return 'EXISTING PROBLEMS IN THIS BOOK: (none yet)';
  const lines = existing.map((p) => `${p.id} | ${p.path} | ${p.text}`);
  return ['EXISTING PROBLEMS IN THIS BOOK (id | path | text):', ...lines].join('\n');
}

/**
 * Build the full extraction prompt, embedding the book's existing problems and — when
 * the book has a learning goal — the relevance-scoring instruction.
 */
export function buildExtractionPrompt(existing: ExistingProblem[], learningGoal?: string): string {
  const parts = [PROMPT_HEAD, '', renderExistingProblems(existing)];
  if (learningGoal && learningGoal.trim()) parts.push(relevanceInstruction(learningGoal.trim()));
  return parts.join('\n');
}

/**
 * JSON Schema for the extraction envelope: resolved deltas + ambiguous pages.
 * `relevance` is OPTIONAL in the schema (a skip carries none, and books with no goal
 * never set it); the route only asks for it via the prompt when a goal is present, and
 * the validator (Task 2) just carries through whatever valid value appears.
 */
export const extractionEnvelopeSchema = {
  type: 'object',
  required: ['resolved', 'needsSection'],
  additionalProperties: false,
  properties: {
    resolved: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'canonicalText'],
        additionalProperties: false,
        properties: {
          kind: { enum: ['add', 'edit', 'skip'] },
          path: { type: 'string' },
          canonicalText: { type: 'string' },
          targetId: { type: 'string' },
          relevance: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    needsSection: {
      type: 'array',
      items: {
        type: 'object',
        required: ['pageIndex', 'problems'],
        additionalProperties: false,
        properties: {
          pageIndex: { type: 'integer' },
          problems: {
            type: 'array',
            items: {
              type: 'object',
              required: ['localLabel', 'canonicalText'],
              additionalProperties: false,
              properties: {
                localLabel: { type: 'string' },
                canonicalText: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
} as const;
