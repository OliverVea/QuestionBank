# Multi-Page Extraction, Path Labels & Derived Section Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-page, book-blind, add-only image extraction with a multi-page (≤5), section-aware, dedupe-capable flow whose labels are dotted paths and whose section tree is derived (not stored) — **while preserving the existing relevance-scoring feature** (per-question high/medium/low against the book's `learningGoal`).

**Architecture:** All change lands in the extraction contract (prompt + schema), a new typed-delta validator (replacing `parseExtractionResult`), the two `/extract` routes (now multi-image + `bookId` + existing-problem context, wired with the store), a pure `buildTree` projection over labels, and `ScanProblemsPage` (multi-image intake, ambiguity prompts, add/edit/skip deltas). The LLM provider interface is untouched. Nothing is persisted by extraction; commit still rides the existing batch PUT.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Express + multer (server), Vitest + supertest (server tests), framework-free TS DOM (client). The reference spec is `docs/superpowers/specs/2026-06-13-multi-page-extraction-design.md`.

> **⚠️ Relevance feature — DO NOT REGRESS.** The codebase already ships relevance scoring, which the spec predates and does not mention. It threads through: `extraction-contract.ts` (`relevanceInstruction(learningGoal)`, `extractionSchemaWithRelevance`), `routes/extract.ts` (reads a `learningGoal` field, conditionally picks prompt+schema), `llm/extract.ts` (validates `relevance`), `domain/types.ts` (`Relevance`, `Question.relevance?`), `services/batch-save.ts` (carries `relevance` on create+update), `routes/questions.ts` (validates it on the PUT), and the client (`ProblemRow`/`ProblemsList`/`EditBookPage` render/edit it; `getProblems()` returns it; the Save PUT sends it). This plan **integrates** relevance into the new multi-page flow rather than dropping it: when a book has a `learningGoal`, the model scores each extracted problem's relevance, it rides the envelope's `resolved` deltas, and it carries through the scan commit. The good news: the **persistence + client-commit half already carries `relevance`** (the `Problem` type, `getProblems()`, and the Save PUT in `EditBookPage` all include it), so the integration work is concentrated server-side in the contract/validator/routes plus the scan page's delta→handoff mapping.

**Conventions in this codebase (read before starting):**
- Server is ESM: every relative import ends in `.js` even though the source is `.ts`.
- Provider failures throw `LlmError`; routes catch it and return 502.
- Customer scoping: routes call `requireCustomerId(req)` (the `resolveCustomer` middleware runs first for every `/api` route, including `/api/extract`).
- Tests favor high-level integration/e2e (route-level with `FakeProvider` + supertest) over granular units. `buildTree` and the delta validator are the exceptions — they are pure functions worth a direct unit test.
- Run a single server test file with: `npm test -w @qb/server -- <path>` (vitest). Run the whole server suite with `npm test -w @qb/server`. Typecheck with `npm run typecheck`.
- Commit messages: multi-line via `git commit -F <file>` to avoid PowerShell here-string breakage, or keep them single-line.

---

## File Structure

**Server — created:**
- `packages/server/src/llm/extraction-tree.ts` — pure `buildTree(problems)` projection from dotted-path labels to an arbitrary-depth tree. New, self-contained, no deps on Express.
- `packages/server/src/llm/extraction-tree.test.ts` — unit test for `buildTree`.
- `packages/server/src/llm/extraction-delta.ts` — the typed-delta types (`Delta`, `NeedsSection`, `ExtractionEnvelope`) + `validateExtractionEnvelope(raw, existingIds, pageCount)` (replaces `parseExtractionResult`'s role). New so the contract file stays prompt/schema-only and the validator is independently testable.
- `packages/server/src/llm/extraction-delta.test.ts` — unit test for the validator's cross-field rules.

**Server — modified:**
- `packages/server/src/llm/extraction-contract.ts` — replace the single-page prompt + array schema with the multi-page prompt builder + `extractionEnvelopeSchema`. **Keep `relevanceInstruction(learningGoal)`** (folded into the new prompt builder); the new envelope schema adds a `relevance` enum to each `resolved` item, gated by whether a goal was given.
- `packages/server/src/routes/extract.ts` — `upload.array('images', 5)`, `bookId` field, load existing problems, build the existing-problems context, **read `learningGoal` (from the book record — see note)**, validate the envelope, both routes; `extractRouter(provider, store)`.
- `packages/server/src/index.ts` — pass `store` into `extractRouter`.
- `packages/server/src/llm/extract.ts` — **DELETED**, but its relevance-validation logic (`VALID_RELEVANCE`, the `relevance` carry-through in `toExtractedQuestion`) moves into the new `extraction-delta.ts` validator. Do not lose it. (`extractQuestions`/`parseExtractionResult`/the old envelope schema are genuinely superseded.)
- `packages/server/src/uat/api-uat.test.ts` — replace the "Scan ingest … (extract route deferred)" flow with a real multi-image extract + skip/add flow (+ the ambiguity round-trip + a relevance-scored flow).

**Client — modified:**
- `packages/client/src/pages/ScanProblemsPage.ts` — multi-image intake, `bookId` in the form, `needsSection` ambiguity prompts + `/refine` with `sectionAnswers`, `skip` rendering, commit carrying `targetId` **and `relevance`** for accepted deltas.
- `packages/client/src/pages/ScanProblemsPage.css` — styles for skip rows + ambiguity prompt bubbles.
- `packages/client/src/components/ProblemsList.ts` — the scan-accepted handoff carries `targetId` so an `edit` updates an existing row instead of adding a new one; the existing `relevance` field on the handoff continues to flow into the row.
- `packages/client/src/lib/photo-transfer.ts` — add `bookId` to `PhotoTransfer`. (It **already** carries `files: File[]` and `learningGoal` — both multi-file and goal threading exist today; only `bookId` is missing.)

**Server/client — context only (read, no change needed):**
- `packages/server/src/services/batch-save.ts` + `packages/server/src/routes/questions.ts` — already carry `relevance` through the batch PUT (create + update + validation). The scan commit reuses this path; no change.
- `packages/client/src/pages/EditBookPage.ts` + `packages/client/src/components/ProblemRow.ts` — already render/edit `relevance`; `getProblems()` returns it and the Save PUT sends it. The scan handoff feeds rows via `addRow({ …, relevance })`, which already exists.

---

## Task 1: Extraction prompt + envelope schema (with relevance)

Replace the single-page, transcribe-only, always-label contract with the multi-page, path-label, dedupe-aware prompt and the `{ resolved, needsSection }` envelope schema. **Fold the existing `relevanceInstruction` into the new prompt builder** and add a `relevance` enum to each resolved item, gated on whether the book has a `learningGoal`. This is prompt/schema text only — validation lives in Task 2.

**Files:**
- Modify: `packages/server/src/llm/extraction-contract.ts` (full rewrite; preserves `relevanceInstruction`)

- [ ] **Step 1: Rewrite the contract file**

Replace the entire contents of `packages/server/src/llm/extraction-contract.ts` with:

```typescript
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
```

- [ ] **Step 2: Verify the old exports are no longer referenced**

Run: `npm run typecheck` from the repo root.
Expected: FAIL — `extract.ts` (the lib) and `routes/extract.ts` still import the now-removed `extractionPrompt` / `extractionSchema` / `extractionSchemaWithRelevance`. (`relevanceInstruction` is KEPT and still exports — it will be re-consumed by the new prompt builder, already done in Step 1.) This failing typecheck confirms Tasks 2–4 have real work. Do not fix here.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/llm/extraction-contract.ts
git commit -m "feat(extract): multi-page prompt + resolved/needsSection envelope schema (keeps relevance)"
```

---

## Task 2: Typed-delta validator + types

The JSON schema can't express the cross-field rules (`add` ⇒ path, no targetId; `edit` ⇒ path + targetId; `skip` ⇒ targetId; every targetId references a real existing problem; pageIndex in range). Put that in a pure, tested validator that the routes call.

**Files:**
- Create: `packages/server/src/llm/extraction-delta.ts`
- Test: `packages/server/src/llm/extraction-delta.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/llm/extraction-delta.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { LlmError } from './provider.js';
import { validateExtractionEnvelope } from './extraction-delta.js';

const EXISTING = ['q1', 'q2'];

describe('validateExtractionEnvelope', () => {
  it('accepts a well-formed add/edit/skip envelope and returns it typed', () => {
    const raw = {
      resolved: [
        { kind: 'add', path: '1.A.3', canonicalText: 'new one' },
        { kind: 'edit', path: '1.A.1', canonicalText: 'fixed', targetId: 'q1' },
        { kind: 'skip', canonicalText: 'unchanged', targetId: 'q2' },
      ],
      needsSection: [
        { pageIndex: 1, problems: [{ localLabel: '4', canonicalText: 'bare four' }] },
      ],
    };
    const env = validateExtractionEnvelope(raw, EXISTING, 2);
    expect(env.resolved).toHaveLength(3);
    expect(env.resolved[0]).toEqual({ kind: 'add', path: '1.A.3', canonicalText: 'new one' });
    expect(env.needsSection[0].pageIndex).toEqual(1);
  });

  it('carries a valid relevance through on add/edit and ignores it on skip', () => {
    const raw = {
      resolved: [
        { kind: 'add', path: '1.A.3', canonicalText: 'new one', relevance: 'high' },
        { kind: 'edit', path: '1.A.1', canonicalText: 'fixed', targetId: 'q1', relevance: 'medium' },
        { kind: 'skip', canonicalText: 'unchanged', targetId: 'q2', relevance: 'low' },
      ],
      needsSection: [],
    };
    const env = validateExtractionEnvelope(raw, EXISTING, 1);
    expect(env.resolved[0].relevance).toEqual('high');
    expect(env.resolved[1].relevance).toEqual('medium');
    // skip carries no relevance into the result (it is never committed).
    expect(env.resolved[2].relevance).toBeUndefined();
  });

  it('drops an invalid relevance value rather than throwing (add stays valid)', () => {
    const raw = { resolved: [{ kind: 'add', path: '1.A.3', canonicalText: 'x', relevance: 'bogus' }], needsSection: [] };
    const env = validateExtractionEnvelope(raw, EXISTING, 1);
    expect(env.resolved[0].relevance).toBeUndefined();
  });

  it('rejects an edit with no targetId (502 via LlmError)', () => {
    const raw = { resolved: [{ kind: 'edit', path: '1.A.1', canonicalText: 'x' }], needsSection: [] };
    expect(() => validateExtractionEnvelope(raw, EXISTING, 1)).toThrow(LlmError);
  });

  it('rejects an add carrying a targetId', () => {
    const raw = { resolved: [{ kind: 'add', path: '1.A.1', canonicalText: 'x', targetId: 'q1' }], needsSection: [] };
    expect(() => validateExtractionEnvelope(raw, EXISTING, 1)).toThrow(LlmError);
  });

  it('rejects an add with no path', () => {
    const raw = { resolved: [{ kind: 'add', canonicalText: 'x' }], needsSection: [] };
    expect(() => validateExtractionEnvelope(raw, EXISTING, 1)).toThrow(LlmError);
  });

  it('rejects a skip whose targetId is not an existing problem', () => {
    const raw = { resolved: [{ kind: 'skip', canonicalText: 'x', targetId: 'ghost' }], needsSection: [] };
    expect(() => validateExtractionEnvelope(raw, EXISTING, 1)).toThrow(LlmError);
  });

  it('rejects a needsSection pageIndex out of range', () => {
    const raw = { resolved: [], needsSection: [{ pageIndex: 5, problems: [{ localLabel: '1', canonicalText: 'x' }] }] };
    expect(() => validateExtractionEnvelope(raw, EXISTING, 2)).toThrow(LlmError);
  });

  it('rejects a non-object / missing-arrays envelope', () => {
    expect(() => validateExtractionEnvelope(null, EXISTING, 1)).toThrow(LlmError);
    expect(() => validateExtractionEnvelope({ resolved: [] }, EXISTING, 1)).toThrow(LlmError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @qb/server -- src/llm/extraction-delta.test.ts`
Expected: FAIL — cannot find module `./extraction-delta.js`.

- [ ] **Step 3: Write the validator**

Create `packages/server/src/llm/extraction-delta.ts`:

```typescript
import { LlmError } from './provider.js';
import type { Relevance } from '../domain/types.js';

const VALID_RELEVANCE = new Set<Relevance>(['high', 'medium', 'low']);

/** A resolved extraction delta the model emits for each problem it found. */
export interface Delta {
  kind: 'add' | 'edit' | 'skip';
  /** Present for add/edit — the derived dotted path. */
  path?: string;
  /** The (possibly corrected) transcription. */
  canonicalText: string;
  /** Present for edit/skip — the existing problem's UUID. */
  targetId?: string;
  /** Relevance to the book's learning goal (only when a goal was given; never on skip). */
  relevance?: Relevance;
}

/** Read a valid relevance off a raw item, or undefined (invalid/absent values are dropped). */
function readRelevance(raw: Record<string, unknown>): Relevance | undefined {
  const r = raw.relevance;
  return typeof r === 'string' && VALID_RELEVANCE.has(r as Relevance) ? (r as Relevance) : undefined;
}

/** Problems on one page the model could not place — the user supplies the prefix. */
export interface NeedsSection {
  /** 0-based index into the uploaded images. */
  pageIndex: number;
  problems: Array<{ localLabel: string; canonicalText: string }>;
}

export interface ExtractionEnvelope {
  resolved: Delta[];
  needsSection: NeedsSection[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

/** Validate one resolved item, enforcing the cross-field rules the JSON schema can't. */
function validateDelta(raw: unknown, existingIds: Set<string>): Delta {
  if (!isObject(raw)) throw new LlmError('resolved item is not an object');
  const { kind, path, canonicalText, targetId } = raw;
  if (kind !== 'add' && kind !== 'edit' && kind !== 'skip') {
    throw new LlmError(`resolved item has invalid kind: ${String(kind)}`);
  }
  if (!nonEmptyString(canonicalText)) {
    throw new LlmError('resolved item missing canonicalText');
  }
  const relevance = readRelevance(raw);
  if (kind === 'add') {
    if (!nonEmptyString(path)) throw new LlmError('add delta requires a path');
    if (targetId !== undefined) throw new LlmError('add delta must not carry a targetId');
    return { kind, path, canonicalText, ...(relevance ? { relevance } : {}) };
  }
  if (kind === 'edit') {
    if (!nonEmptyString(path)) throw new LlmError('edit delta requires a path');
    if (!nonEmptyString(targetId)) throw new LlmError('edit delta requires a targetId');
    if (!existingIds.has(targetId)) throw new LlmError(`edit targetId is not an existing problem: ${targetId}`);
    return { kind, path, canonicalText, targetId, ...(relevance ? { relevance } : {}) };
  }
  // skip — never carries relevance (it is informational only, never committed).
  if (!nonEmptyString(targetId)) throw new LlmError('skip delta requires a targetId');
  if (!existingIds.has(targetId)) throw new LlmError(`skip targetId is not an existing problem: ${targetId}`);
  return { kind, canonicalText, targetId };
}

/** Validate one needsSection page entry. */
function validateNeedsSection(raw: unknown, pageCount: number): NeedsSection {
  if (!isObject(raw)) throw new LlmError('needsSection item is not an object');
  const { pageIndex, problems } = raw;
  if (typeof pageIndex !== 'number' || !Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) {
    throw new LlmError(`needsSection pageIndex out of range: ${String(pageIndex)}`);
  }
  if (!Array.isArray(problems)) throw new LlmError('needsSection problems must be an array');
  const validated = problems.map((p) => {
    if (!isObject(p) || !nonEmptyString(p.localLabel) || !nonEmptyString(p.canonicalText)) {
      throw new LlmError('needsSection problem missing localLabel/canonicalText');
    }
    return { localLabel: p.localLabel, canonicalText: p.canonicalText };
  });
  return { pageIndex, problems: validated };
}

/**
 * Validate the raw model output into a typed ExtractionEnvelope, enforcing the
 * cross-field rules the JSON schema can't express. Throws LlmError (→ 502) on any
 * violation. `existingIds` are the book's current problem UUIDs; `pageCount` is the
 * number of uploaded images.
 */
export function validateExtractionEnvelope(
  raw: unknown,
  existingIds: string[],
  pageCount: number,
): ExtractionEnvelope {
  if (!isObject(raw)) throw new LlmError('extraction result is not an object');
  const { resolved, needsSection } = raw;
  if (!Array.isArray(resolved)) throw new LlmError('extraction result has no resolved array');
  if (!Array.isArray(needsSection)) throw new LlmError('extraction result has no needsSection array');
  const ids = new Set(existingIds);
  return {
    resolved: resolved.map((d) => validateDelta(d, ids)),
    needsSection: needsSection.map((n) => validateNeedsSection(n, pageCount)),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @qb/server -- src/llm/extraction-delta.test.ts`
Expected: PASS — all 9 cases green (including the two relevance cases).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/llm/extraction-delta.ts packages/server/src/llm/extraction-delta.test.ts
git commit -m "feat(extract): typed-delta envelope validator with cross-field rules"
```

---

## Task 3: `buildTree` — derived section tree

A pure projection from flat problems (each with a dotted-path label and a `createdAt`) to an arbitrary-depth tree. No storage, no entity. Used later by the section-tree view and learn-by-node.

**Files:**
- Create: `packages/server/src/llm/extraction-tree.ts`
- Test: `packages/server/src/llm/extraction-tree.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/llm/extraction-tree.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildTree, type TreeProblem } from './extraction-tree.js';

/** Minimal problem shape buildTree needs: id, the dotted label, and createdAt for ordering. */
function p(id: string, label: string, createdAt: string): TreeProblem {
  return { id, label, createdAt };
}

describe('buildTree', () => {
  it('reconstructs a multi-level tree from dotted paths', () => {
    const tree = buildTree([
      p('a', '1.A.1', '2026-01-01T00:00:00.000Z'),
      p('b', '1.A.2', '2026-01-02T00:00:00.000Z'),
      p('c', '1.B.1', '2026-01-03T00:00:00.000Z'),
      p('d', '2.1', '2026-01-04T00:00:00.000Z'),
      p('e', 'Warm-ups', '2026-01-05T00:00:00.000Z'),
    ]);
    // Top-level segments, in first-seen order.
    expect(tree.map((n) => n.segment)).toEqual(['1', '2', 'Warm-ups']);
    const chapter1 = tree[0];
    expect(chapter1.children.map((n) => n.segment)).toEqual(['A', 'B']);
    const sectionA = chapter1.children[0];
    // Leaf segments under 1.A are the final path segments.
    expect(sectionA.children.map((n) => n.segment)).toEqual(['1', '2']);
    // The leaves carry the problem ids.
    expect(sectionA.children[0].problems.map((q) => q.id)).toEqual(['a']);
    // A single-segment label is a top-level leaf carrying its problem.
    const warmups = tree[2];
    expect(warmups.problems.map((q) => q.id)).toEqual(['e']);
  });

  it('collects two problems sharing a full path at one leaf, ordered by createdAt', () => {
    const tree = buildTree([
      p('late', '1.A.3', '2026-01-09T00:00:00.000Z'),
      p('early', '1.A.3', '2026-01-01T00:00:00.000Z'),
    ]);
    const leaf = tree[0].children[0].children[0];
    expect(leaf.segment).toEqual('3');
    expect(leaf.problems.map((q) => q.id)).toEqual(['early', 'late']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @qb/server -- src/llm/extraction-tree.test.ts`
Expected: FAIL — cannot find module `./extraction-tree.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/server/src/llm/extraction-tree.ts`:

```typescript
/** The minimal problem shape the tree projection needs. */
export interface TreeProblem {
  id: string;
  /** The dotted-path label, e.g. "1.A.3". */
  label: string;
  /** ISO timestamp — orders problems that share a full path. */
  createdAt: string;
}

/** One node of the derived section tree. Internal nodes have children; leaves carry problems. */
export interface TreeNode {
  /** This level's path segment, e.g. "1", "A", "Warm-ups". */
  segment: string;
  children: TreeNode[];
  /** Problems whose full path ends at this node, oldest-first. */
  problems: TreeProblem[];
}

/**
 * Project a flat problem list into an arbitrary-depth tree by splitting each label on ".".
 * First-seen order is preserved at each level. Problems sharing a full path collect at one
 * leaf, ordered by createdAt. A label with no "." is a single-segment (top-level) node.
 * Pure: no storage, no mutation of inputs.
 */
export function buildTree(problems: TreeProblem[]): TreeNode[] {
  const roots: TreeNode[] = [];

  function childBySegment(siblings: TreeNode[], segment: string): TreeNode {
    let node = siblings.find((n) => n.segment === segment);
    if (!node) {
      node = { segment, children: [], problems: [] };
      siblings.push(node);
    }
    return node;
  }

  for (const problem of problems) {
    const segments = problem.label.split('.');
    let level = roots;
    let node: TreeNode | undefined;
    for (const segment of segments) {
      node = childBySegment(level, segment);
      level = node.children;
    }
    // node is the leaf for this problem's full path.
    node!.problems.push(problem);
  }

  // Order each leaf's co-located problems oldest-first (stable for equal timestamps).
  function sortLeaves(nodes: TreeNode[]): void {
    for (const n of nodes) {
      if (n.problems.length > 1) {
        n.problems.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
      }
      sortLeaves(n.children);
    }
  }
  sortLeaves(roots);

  return roots;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @qb/server -- src/llm/extraction-tree.test.ts`
Expected: PASS — both cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/llm/extraction-tree.ts packages/server/src/llm/extraction-tree.test.ts
git commit -m "feat(extract): derive section tree from dotted-path labels"
```

---

## Task 4: `/extract` route — multi-image + existing-problems context

Rewrite the primary route: accept up to 5 images (`upload.array('images', 5)`), require `bookId`, load the book's existing problems, build the prompt with their context, call the provider, validate into the envelope, return `{ resolved, needsSection }`. Wire the store in.

**Files:**
- Modify: `packages/server/src/routes/extract.ts` (full rewrite of the primary route + signature)
- Modify: `packages/server/src/index.ts:60`
- Delete: `packages/server/src/llm/extract.ts` (its three exports are superseded — verified below)
- Test: `packages/server/src/routes/extract.test.ts` (new)

- [ ] **Step 1: Confirm `extract.ts` lib is dead, then delete it**

Run: `grep -rn "from './extract.js'\|from '../llm/extract.js'\|extractQuestions\|parseExtractionResult" packages/server/src`
Expected: matches only in `packages/server/src/routes/extract.ts` (the route we're rewriting) and `packages/server/src/llm/extract.ts` itself. No other consumer.

If that holds, delete the file:

```bash
git rm packages/server/src/llm/extract.ts
```

(If the grep surfaces an unexpected consumer, stop and reconcile before continuing — do not delete.)

- [ ] **Step 2: Write the failing route test**

Create `packages/server/src/routes/extract.test.ts`:

```typescript
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { FakeProvider } from '../llm/fake-provider.js';
import { Store } from '../storage/store.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

let dir: string;
let store: Store;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-extract-'));
  store = await Store.open(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Create a book and one problem, returning their ids. */
async function seedBook(app: ReturnType<typeof createApp>): Promise<{ bookId: string; questionId: string }> {
  const book = await request(app).post('/api/books').send({ title: 'Calc' });
  const saved = await request(app)
    .put(`/api/books/${book.body.id}/questions`)
    .send({ questions: [{ label: '1.A.1', canonicalText: 'Differentiate x^2' }] });
  return { bookId: book.body.id, questionId: saved.body[0].id };
}

describe('POST /api/extract (multi-page)', () => {
  it('passes existing problems into the provider and returns resolved + needsSection', async () => {
    const provider = new FakeProvider();
    const app = createApp(store, provider, undefined);
    const { bookId, questionId } = await seedBook(app);

    // Script the model: skip the known problem, add a new one, flag one ambiguous page.
    provider['config'] = {
      structured: {
        resolved: [
          { kind: 'skip', canonicalText: 'Differentiate x^2', targetId: questionId },
          { kind: 'add', path: '1.A.2', canonicalText: 'Integrate 2x' },
        ],
        needsSection: [{ pageIndex: 1, problems: [{ localLabel: '4', canonicalText: 'bare four' }] }],
      },
    };

    const res = await request(app)
      .post('/api/extract')
      .field('bookId', bookId)
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' })
      .attach('images', PNG, { filename: 'p2.png', contentType: 'image/png' });

    expect(res.status).toEqual(200);
    expect(res.body.resolved).toHaveLength(2);
    expect(res.body.needsSection[0].pageIndex).toEqual(1);

    // The existing problem (id|path|text) reached the model's prompt.
    const sent = provider.lastConversation[0];
    expect(sent.images).toHaveLength(2);
    expect(sent.text).toContain(questionId);
    expect(sent.text).toContain('1.A.1');
  });

  it('rejects a request with no images (400)', async () => {
    const app = createApp(store, new FakeProvider(), undefined);
    const { bookId } = await seedBook(app);
    const res = await request(app).post('/api/extract').field('bookId', bookId);
    expect(res.status).toEqual(400);
  });

  it('rejects a missing bookId (400)', async () => {
    const app = createApp(store, new FakeProvider(), undefined);
    const res = await request(app)
      .post('/api/extract')
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });
    expect(res.status).toEqual(400);
  });

  it('rejects an unknown book (404)', async () => {
    const app = createApp(store, new FakeProvider(), undefined);
    const res = await request(app)
      .post('/api/extract')
      .field('bookId', 'ghost')
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });
    expect(res.status).toEqual(404);
  });

  it('rejects a 6th image (400)', async () => {
    const app = createApp(store, new FakeProvider(), undefined);
    const { bookId } = await seedBook(app);
    let req = request(app).post('/api/extract').field('bookId', bookId);
    for (let i = 0; i < 6; i++) {
      req = req.attach('images', PNG, { filename: `p${i}.png`, contentType: 'image/png' });
    }
    const res = await req;
    expect(res.status).toEqual(400);
  });

  it('returns 502 when the model emits a cross-field-invalid delta', async () => {
    const provider = new FakeProvider({
      structured: { resolved: [{ kind: 'edit', path: '1.A.1', canonicalText: 'x' }], needsSection: [] },
    });
    const app = createApp(store, provider, undefined);
    const { bookId } = await seedBook(app);
    const res = await request(app)
      .post('/api/extract')
      .field('bookId', bookId)
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });
    expect(res.status).toEqual(502);
  });

  it('asks for relevance only when the book has a learningGoal, and carries it through', async () => {
    const provider = new FakeProvider({
      structured: {
        resolved: [{ kind: 'add', path: '1.A.1', canonicalText: 'q', relevance: 'high' }],
        needsSection: [],
      },
    });
    const app = createApp(store, provider, undefined);

    // A goal-bearing book: the prompt includes the relevance instruction and the result keeps it.
    const goalBook = await request(app).post('/api/books').send({ title: 'Calc', learningGoal: 'master derivatives' });
    const withGoal = await request(app)
      .post('/api/extract')
      .field('bookId', goalBook.body.id)
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });
    expect(withGoal.status).toEqual(200);
    expect(provider.lastConversation[0].text).toContain('master derivatives');
    expect(withGoal.body.resolved[0].relevance).toEqual('high');

    // A goal-less book: the prompt omits relevance scoring entirely.
    const plainBook = await request(app).post('/api/books').send({ title: 'NoGoal' });
    await request(app)
      .post('/api/extract')
      .field('bookId', plainBook.body.id)
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });
    expect(provider.lastConversation[0].text).not.toContain('learning goal for this book');
  });
});

describe('POST /api/extract/refine', () => {
  it('builds a user→assistant→user transcript carrying the section answers, returns the envelope', async () => {
    const provider = new FakeProvider({
      structured: {
        resolved: [{ kind: 'add', path: '1.A.4', canonicalText: 'Integrate 4x' }],
        needsSection: [],
      },
    });
    const app = createApp(store, provider, undefined);
    const { bookId } = await seedBook(app);

    const prior = {
      resolved: [],
      needsSection: [{ pageIndex: 1, problems: [{ localLabel: '4', canonicalText: 'Integrate 4x' }] }],
    };
    const res = await request(app)
      .post('/api/extract/refine')
      .field('bookId', bookId)
      .field('currentExtraction', JSON.stringify(prior))
      .field('sectionAnswers', JSON.stringify({ '1': '1.A' }))
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' })
      .attach('images', PNG, { filename: 'p2.png', contentType: 'image/png' });

    expect(res.status).toEqual(200);
    expect(res.body.needsSection).toEqual([]);
    expect(res.body.resolved[0].path).toEqual('1.A.4');

    // Transcript: user(prompt+images) → assistant(prior envelope JSON) → user(correction).
    const convo = provider.lastConversation;
    expect(convo.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(convo[0].images).toHaveLength(2);
    expect(convo[1].text).toContain('needsSection');
    // The user's section answer is stated in the correction turn.
    expect(convo[2].text).toContain('1.A');
  });

  it('rejects refine with a missing bookId (400)', async () => {
    const app = createApp(store, new FakeProvider(), undefined);
    const res = await request(app)
      .post('/api/extract/refine')
      .field('sectionAnswers', JSON.stringify({ '1': '1.A' }))
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });
    expect(res.status).toEqual(400);
  });
});
```

Note on the `provider['config'] = …` line in the first test: `FakeProvider`'s `config` is a private readonly field, so reassigning it from the test is a deliberate bracket-access shim (TypeScript allows the bracket form to dodge the visibility check at the test boundary). The other tests pass `structured` via the constructor, which is the normal path — prefer that. Use the reassignment form only when you need the same `provider` instance both before and after seeding (here, to read `lastConversation`).

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -w @qb/server -- src/routes/extract.test.ts`
Expected: FAIL — `extractRouter` still single-image / no store; typecheck-adjacent failures and 400/404 mismatches.

- [ ] **Step 4: Rewrite the route**

Replace the entire contents of `packages/server/src/routes/extract.ts` with:

```typescript
import { Router } from 'express';
import multer from 'multer';
import { bufferImage, type ImageMimeType } from '../llm/image-ref.js';
import { LlmError, type LlmProvider, type Message } from '../llm/provider.js';
import {
  buildExtractionPrompt,
  extractionEnvelopeSchema,
  type ExistingProblem,
} from '../llm/extraction-contract.js';
import { validateExtractionEnvelope, type ExtractionEnvelope } from '../llm/extraction-delta.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import type { Store } from '../storage/store.js';
import { log } from '../logging/logger.js';

const MAX_IMAGES = 5;

const VALID_MIME: Record<string, ImageMimeType> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
};

/** Load the book's existing problems as { id, path, text } for the dedupe prompt. */
async function loadExisting(
  store: Store,
  customerId: string,
  bookId: string,
): Promise<ExistingProblem[]> {
  const questions = (await store.questions.getAll(customerId)).filter((q) => q.bookId === bookId);
  return questions.map((q) => ({ id: q.id, path: q.label, text: q.canonicalText }));
}

/**
 * POST /api/extract — accepts 1..5 page images + a bookId, returns a typed extraction
 * envelope (resolved deltas + ambiguous pages). The model sees the book's existing
 * problems and emits add/edit/skip. Stateless: nothing is persisted; the client commits
 * via the normal problem CRUD.
 *
 * POST /api/extract/refine — same images + prior envelope + the user's per-page section
 * answers, re-extracts so ambiguous pages fold into resolved.
 */
export function extractRouter(provider: LlmProvider, store: Store): Router {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: MAX_IMAGES }, // 10 MB/file, 5 files max
  });

  // multer throws a LIMIT_FILE_COUNT error past `files`; turn that (and any multer error)
  // into a clean 400 rather than a 500.
  const acceptImages = (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
    upload.array('images', MAX_IMAGES)(req, res, (err: unknown) => {
      if (err) {
        res.status(400).json({ error: `up to ${MAX_IMAGES} page images, each ≤10 MB` });
        return;
      }
      next();
    });
  };

  /** Pull validated ImageRefs from the multipart files, or null if any is wrong. */
  function readImages(req: import('express').Request): ReturnType<typeof bufferImage>[] | null {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) return null;
    const refs = [];
    for (const f of files) {
      if (!(f.mimetype in VALID_MIME)) return null;
      refs.push(bufferImage(f.buffer, f.mimetype as ImageMimeType));
    }
    return refs;
  }

  router.post('/', acceptImages, async (req, res) => {
    const customerId = requireCustomerId(req);
    const bookId = (req.body ?? {}).bookId;
    if (typeof bookId !== 'string' || bookId.trim() === '') {
      res.status(400).json({ error: 'bookId is required' });
      return;
    }
    const images = readImages(req);
    if (!images) {
      res.status(400).json({ error: 'attach 1–5 image files (png, jpeg, webp, gif)' });
      return;
    }
    const book = await store.books.getById(customerId, bookId);
    if (!book) {
      res.status(404).json({ error: 'book not found' });
      return;
    }

    const existing = await loadExisting(store, customerId, bookId);
    // Relevance scoring rides the book's own learningGoal — no client field needed (the
    // book is already loaded). When the book has no goal, the prompt omits relevance.
    const prompt = buildExtractionPrompt(existing, book.learningGoal);
    const messages: Message[] = [{ role: 'user', text: prompt, images }];
    log.info('extracting problems from pages', {
      pages: images.length,
      existing: existing.length,
      hasGoal: !!book.learningGoal,
    });

    try {
      const raw = await provider.completeStructured<unknown>(messages, extractionEnvelopeSchema);
      const envelope = validateExtractionEnvelope(raw, existing.map((e) => e.id), images.length);
      res.json(envelope);
    } catch (err) {
      if (err instanceof LlmError) {
        log.warn('extraction failed', { error: (err as Error).message });
        res.status(502).json({ error: 'extraction failed' });
        return;
      }
      throw err;
    }
  });

  /** Refine: re-extract with the user's per-page section answers folded in. */
  router.post('/refine', acceptImages, async (req, res) => {
    const customerId = requireCustomerId(req);
    const body = req.body ?? {};
    const bookId = body.bookId;
    if (typeof bookId !== 'string' || bookId.trim() === '') {
      res.status(400).json({ error: 'bookId is required' });
      return;
    }
    const images = readImages(req);
    if (!images) {
      res.status(400).json({ error: 'attach 1–5 image files (png, jpeg, webp, gif)' });
      return;
    }
    const book = await store.books.getById(customerId, bookId);
    if (!book) {
      res.status(404).json({ error: 'book not found' });
      return;
    }

    // Parse the prior envelope + the user's answers. Tolerate malformed JSON (fall back to empty).
    let prior: ExtractionEnvelope = { resolved: [], needsSection: [] };
    if (typeof body.currentExtraction === 'string') {
      try { prior = JSON.parse(body.currentExtraction); } catch { /* keep empty */ }
    }
    let sectionAnswers: Record<string, string> = {};
    if (typeof body.sectionAnswers === 'string') {
      try { sectionAnswers = JSON.parse(body.sectionAnswers); } catch { /* keep empty */ }
    }
    const note = typeof body.note === 'string' ? body.note : '';

    const existing = await loadExisting(store, customerId, bookId);
    const prompt = buildExtractionPrompt(existing, book.learningGoal);

    // Describe the section answers as an instruction line per answered page.
    const answerLines = Object.entries(sectionAnswers).map(
      ([pageIndex, prefix]) => `Page ${pageIndex}: these problems belong under "${prefix}".`,
    );
    const correction = [
      'Apply the following and return the full updated envelope. Fold any needsSection',
      'problems for the pages named below into `resolved` as `add`s, building each path from',
      'the given prefix and the problem\'s local label.',
      ...answerLines,
      ...(note.trim() ? ['', `Additional note: ${note.trim()}`] : []),
    ].join('\n');

    const messages: Message[] = [
      { role: 'user', text: prompt, images },
      { role: 'assistant', text: JSON.stringify(prior) },
      { role: 'user', text: correction },
    ];
    log.info('refining extraction', { pages: images.length, answers: answerLines.length });

    try {
      const raw = await provider.completeStructured<unknown>(messages, extractionEnvelopeSchema);
      const envelope = validateExtractionEnvelope(raw, existing.map((e) => e.id), images.length);
      res.json(envelope);
    } catch (err) {
      if (err instanceof LlmError) {
        log.warn('refinement failed', { error: (err as Error).message });
        res.status(502).json({ error: 'refinement failed' });
        return;
      }
      throw err;
    }
  });

  return router;
}
```

- [ ] **Step 5: Wire the store into the router**

In `packages/server/src/index.ts`, change line 60 from:

```typescript
  app.use('/api/extract', extractRouter(provider));
```

to:

```typescript
  app.use('/api/extract', extractRouter(provider, store));
```

- [ ] **Step 6: Run the route test + typecheck**

Run: `npm test -w @qb/server -- src/routes/extract.test.ts`
Expected: PASS — all cases green (7 in the `/extract` block incl. the relevance case + 2 in the `/refine` block).

Run: `npm run typecheck`
Expected: PASS — no dangling imports of the deleted `extract.ts` lib or removed contract exports.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/extract.ts packages/server/src/routes/extract.test.ts packages/server/src/index.ts
git rm --cached packages/server/src/llm/extract.ts 2>/dev/null || true
git commit -m "feat(extract): multi-image route with existing-problem context + envelope validation"
```

---

## Task 5: UAT — real multi-image extract + refine flow

Replace the deferred-extract placeholder UAT flow with three real flows:
1. A multi-image extract that skips a known problem and adds a new one, then commits the add via the batch PUT and confirms only the new problem landed.
2. The **ambiguity round-trip** — extract returns a `needsSection` page; `/refine` with `sectionAnswers` folds those problems into `resolved` under the chosen prefix and clears `needsSection`. This is the most novel part of the spec and must be UAT-covered, not just unit-tested.
3. The **relevance round-trip** — a goal-bearing book's extract scores each added problem's relevance, and committing it via the batch PUT persists the relevance onto the stored question (proving the new flow doesn't regress the existing relevance feature end-to-end).

**Files:**
- Modify: `packages/server/src/uat/api-uat.test.ts` (flow #7, lines ~366–389)

- [ ] **Step 1: Replace the deferred Scan-ingest flow**

In `packages/server/src/uat/api-uat.test.ts`, replace the entire `it('Scan ingest: accepted scanned problems persist via the batch PUT (extract route deferred)', …)` test (and its preceding section comment block) with:

```typescript
  // -------------------------------------------------------------------------
  // 7. SCAN INGEST — multi-page extract: the model sees the book's existing
  //    problems and emits add/edit/skip. A re-scanned known problem is a skip;
  //    a new one is an add. Extract persists nothing; the accepted add commits
  //    through the same batch PUT as any other edit.
  // -------------------------------------------------------------------------
  it('Scan ingest: extract skips a known problem + adds a new one; the add commits via batch PUT', async () => {
    const book = await createBook();
    const [known] = await saveProblems(book.id, [{ label: '1.A.1', canonicalText: 'Differentiate x^2' }]);

    // Script the model: skip the known problem (by its id), add a new one.
    const scanApp = createApp(
      store,
      new FakeProvider({
        structured: {
          resolved: [
            { kind: 'skip', canonicalText: 'Differentiate x^2', targetId: known.id },
            { kind: 'add', path: '1.A.2', canonicalText: 'Integrate 2x' },
          ],
          needsSection: [],
        },
      }),
      undefined,
    );

    const extract = await request(scanApp)
      .post('/api/extract')
      .field('bookId', book.id)
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' })
      .attach('images', PNG, { filename: 'p2.png', contentType: 'image/png' });
    expect(extract.status).toEqual(200);
    expect(extract.body.resolved.map((d: { kind: string }) => d.kind)).toEqual(['skip', 'add']);

    // Extract persisted nothing — the book still has just the one known problem.
    expect((await request(app).get(`/api/books/${book.id}/questions`)).body).toHaveLength(1);

    // The user accepts the `add` and commits via the normal batch PUT: keep the existing
    // problem (by id) and append the new one (label = its path).
    const add = extract.body.resolved.find((d: { kind: string }) => d.kind === 'add');
    const saved = await saveProblems(book.id, [
      { id: known.id, label: '1.A.1', canonicalText: 'Differentiate x^2' },
      { label: add.path, canonicalText: add.canonicalText },
    ]);
    expect(saved.map((q) => q.canonicalText)).toEqual(['Differentiate x^2', 'Integrate 2x']);
    expect(saved.map((q) => q.label)).toEqual(['1.A.1', '1.A.2']);
  });

  // -------------------------------------------------------------------------
  // 7b. SCAN AMBIGUITY ROUND-TRIP — a page with bare numbers comes back under
  //     needsSection; the user supplies the section prefix; /refine folds those
  //     problems into resolved as adds under that prefix and clears needsSection.
  //     The commit then persists them via the batch PUT.
  // -------------------------------------------------------------------------
  it('Scan ambiguity: a needsSection page is resolved via /refine, then commits', async () => {
    const book = await createBook();

    // First pass: the model can't place page 2's bare "4", so it flags needsSection.
    const extractApp = createApp(
      store,
      new FakeProvider({
        structured: {
          resolved: [{ kind: 'add', path: '1.A.1', canonicalText: 'Differentiate x^2' }],
          needsSection: [{ pageIndex: 1, problems: [{ localLabel: '4', canonicalText: 'Integrate 4x' }] }],
        },
      }),
      undefined,
    );

    const first = await request(extractApp)
      .post('/api/extract')
      .field('bookId', book.id)
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' })
      .attach('images', PNG, { filename: 'p2.png', contentType: 'image/png' });
    expect(first.status).toEqual(200);
    expect(first.body.needsSection).toHaveLength(1);
    expect(first.body.needsSection[0].pageIndex).toEqual(1);

    // Second pass: the user answered "page 1 → 1.A". The refined model now folds the
    // bare "4" into resolved as an add under "1.A.4" and returns an empty needsSection.
    const refineApp = createApp(
      store,
      new FakeProvider({
        structured: {
          resolved: [
            { kind: 'add', path: '1.A.1', canonicalText: 'Differentiate x^2' },
            { kind: 'add', path: '1.A.4', canonicalText: 'Integrate 4x' },
          ],
          needsSection: [],
        },
      }),
      undefined,
    );

    const refined = await request(refineApp)
      .post('/api/extract/refine')
      .field('bookId', book.id)
      .field('currentExtraction', JSON.stringify(first.body))
      .field('sectionAnswers', JSON.stringify({ '1': '1.A' }))
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' })
      .attach('images', PNG, { filename: 'p2.png', contentType: 'image/png' });
    expect(refined.status).toEqual(200);
    expect(refined.body.needsSection).toEqual([]);
    expect(refined.body.resolved.map((d: { path: string }) => d.path)).toEqual(['1.A.1', '1.A.4']);

    // The user's section answer reached the refine conversation (the correction turn).
    // (Asserted indirectly here via the resolved paths; the transcript shape is unit-tested
    // in the route test. The refine request must carry sectionAnswers as a multipart field.)

    // Commit both adds via the batch PUT.
    const saved = await saveProblems(
      book.id,
      refined.body.resolved.map((d: { path: string; canonicalText: string }) => ({
        label: d.path,
        canonicalText: d.canonicalText,
      })),
    );
    expect(saved.map((q) => q.label)).toEqual(['1.A.1', '1.A.4']);
  });

  // -------------------------------------------------------------------------
  // 7c. SCAN RELEVANCE — a goal-bearing book scores each extracted problem's
  //     relevance; committing the accepted add via the batch PUT persists that
  //     relevance onto the stored question. Proves the multi-page flow does not
  //     regress the existing relevance feature end-to-end.
  // -------------------------------------------------------------------------
  it('Scan relevance: extract scores relevance for a goal-bearing book; commit persists it', async () => {
    const book = await createBook({ learningGoal: 'master integration' });

    const scanApp = createApp(
      store,
      new FakeProvider({
        structured: {
          resolved: [{ kind: 'add', path: '3.1', canonicalText: 'Integrate sin x', relevance: 'high' }],
          needsSection: [],
        },
      }),
      undefined,
    );

    const extract = await request(scanApp)
      .post('/api/extract')
      .field('bookId', book.id)
      .attach('images', PNG, { filename: 'p1.png', contentType: 'image/png' });
    expect(extract.status).toEqual(200);
    const add = extract.body.resolved[0];
    expect(add.relevance).toEqual('high');

    // Commit through the batch PUT carrying the scored relevance (the path the scan page
    // uses: label = path, plus relevance). The questions route persists relevance.
    const put = await request(app)
      .put(`/api/books/${book.id}/questions`)
      .send({ questions: [{ label: add.path, canonicalText: add.canonicalText, relevance: add.relevance }] });
    expect(put.status).toEqual(200);

    // The stored question carries the relevance, visible on the book-questions read.
    const list = (await request(app).get(`/api/books/${book.id}/questions`)).body;
    expect(list[0].relevance).toEqual('high');
  });
```

- [ ] **Step 2: Run the full UAT suite**

Run: `npm test -w @qb/server -- src/uat/api-uat.test.ts`
Expected: PASS — every flow green, including the rewritten Scan ingest.

- [ ] **Step 3: Run the whole server suite + typecheck**

Run: `npm test -w @qb/server`
Expected: PASS — all server tests green.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/uat/api-uat.test.ts
git commit -m "test(uat): real multi-image extract skip/add flow replaces deferred placeholder"
```

---

## Task 6: Client — multi-image intake, upload spinner, ambiguity prompts, typed deltas

Grow `ScanProblemsPage` from single-image/add-only to multi-image with `bookId`, `needsSection` ambiguity prompts → `/refine` with `sectionAnswers`, and add/edit/skip rendering. Carry `targetId` (so an `edit` updates an existing row) **and `relevance`** through commit. **Upload feedback:** the page must show an explicit spinner while the images upload and confirm a successful upload before the "reading the pages" phase — so the user knows the photo fully arrived and sees a distinct error if the upload itself fails. This is done with an XHR-based POST (fetch can't report upload progress). This task has no automated test (the client has no test harness here); the observable is the manual e2e in Task 7.

**What already exists (do not rebuild):** `ProblemsList` already has a multi-file picker (`fileInput.multiple = true`), a `PhotoReviewModal`, and calls `stashPhotos({ files, notes, learningGoal })`. `PhotoTransfer` already carries `files: File[]` and `learningGoal`. The `Problem` type, `getProblems()`, and `EditBookPage`'s Save PUT already carry `relevance`. **The only gaps are:** `PhotoTransfer` has no `bookId`; the scan page reads `files[0]` only and posts a single image with no `bookId`; the handoff doesn't route `edit` deltas. Relevance scoring is now driven by the **book's stored `learningGoal`** server-side (Task 4), so the client no longer needs to pass `learningGoal` for scoring — but leave the existing `learningGoal` stash in place (harmless; the refine note path may still use it, and removing it is out of scope).

**Files:**
- Modify: `packages/client/src/lib/photo-transfer.ts` (add `bookId`)
- Modify: `packages/client/src/pages/ScanProblemsPage.ts` (substantial rewrite of intake, network, delta mapping, commit)
- Modify: `packages/client/src/pages/ScanProblemsPage.css` (skip-row + prompt styles)
- Modify: `packages/client/src/components/ProblemsList.ts` (thread `bookId` into the stash; route `edit` deltas + relevance in the handoff)

- [ ] **Step 1: Thread `bookId` from `EditBookPage` → `ProblemsList` → the stash**

`stashPhotos` is called inside `ProblemsList` (the `fileInput` change handler), but the book id lives in `EditBookPage` (`const bookId = params.get('id')`). Add a `bookId` prop to `ProblemsList` and pass it at the stash call.

In `packages/client/src/components/ProblemsList.ts`, extend `ProblemsListProps`:

```typescript
export interface ProblemsListProps {
  problems?: Problem[];
  onChange?: () => void;
  /** Supplier for the current learning goal (may change after mount). */
  getLearningGoal?: () => string;
  /** The book being edited — stashed into the scan transfer so /extract can load existing problems. */
  bookId?: string;
}
```

Destructure `bookId` in the function signature (`export function ProblemsList({ problems = [], onChange, getLearningGoal, bookId }: ProblemsListProps = {})`), and at the `stashPhotos(...)` call in the `fileInput` change handler, add it:

```typescript
        const goal = getLearningGoal?.();
        stashPhotos({ files: posted, notes, ...(bookId ? { bookId } : {}), ...(goal ? { learningGoal: goal } : {}) });
```

In `packages/client/src/pages/EditBookPage.ts`, pass the id when constructing the list (around line 53):

```typescript
  const problemsList = ProblemsList({ onChange: markDirty, getLearningGoal: () => goalInput.value.trim(), bookId });
```

- [ ] **Step 2: Add `bookId` to `PhotoTransfer`**

In `packages/client/src/lib/photo-transfer.ts`, add `bookId` to the interface (`learningGoal` is already there):

```typescript
export interface PhotoTransfer {
  files: File[];
  notes: string;
  /** The book being scanned into — needed by /extract to load existing problems. */
  bookId?: string;
  /** Optional learning goal (already supported). */
  learningGoal?: string;
}
```

> Read the current `PhotoTransfer` first and add only the missing `bookId` field — `learningGoal` is already declared. Keep both optional so other `stashPhotos` callers don't break.

- [ ] **Step 3: Honor `targetId` (edit) + `relevance` in the `ProblemsList` scan handoff**

The scan page commits accepted deltas by writing them to `sessionStorage[SCAN_ACCEPTED_KEY]`; `ProblemsList.checkForReturnedProblems()` reads them as `Problem[]` and calls `addRow(p)` for each. The `Problem` type already includes `relevance`, so a scored `add` flows through unchanged once the scan page includes it in the handoff (done in Step 4's commit block). **The one new behavior** is `edit`: an accepted `edit` delta carries a `targetId` (the existing problem's id) and must UPDATE that existing row, not append a new one.

`ProblemsList` tracks rows as two parallel arrays — `rows: ProblemRowHandle[]` and `rowIds: (string | undefined)[]` — and `ProblemRowHandle` has no value setters (label/latex/relevance are fixed at construction). So the simplest correct update is: find the row by its id, remove it, and re-add a fresh row with the new values at the same position, preserving its id.

In `packages/client/src/components/ProblemsList.ts`:

(a) Extend the `Problem` type (around line 10) to allow the handoff to carry the edit target id. `relevance` is already present:

```typescript
export interface Problem {
  id?: string;
  label: string;
  latex: string;
  relevance?: Relevance;
  /** When present (scan-edit handoff), this replaces the existing row with this id. */
  targetId?: string;
}
```

(b) Replace `checkForReturnedProblems` (around lines 169–178) with a version that routes edits to an in-place replace and everything else to `addRow`:

```typescript
  // Check for returned problems from scan page. An `edit` (targetId set) replaces the
  // existing row with that id; everything else is a new row. relevance rides through.
  function checkForReturnedProblems() {
    const raw = sessionStorage.getItem(SCAN_ACCEPTED_KEY);
    if (!raw) return;
    sessionStorage.removeItem(SCAN_ACCEPTED_KEY);
    try {
      const accepted: Problem[] = JSON.parse(raw);
      for (const p of accepted) {
        if (p.targetId) {
          replaceRowById(p.targetId, { id: p.targetId, label: p.label, latex: p.latex, ...(p.relevance ? { relevance: p.relevance } : {}) });
        } else {
          addRow(p);
        }
      }
      notify();
    } catch { /* ignore malformed */ }
  }

  /**
   * Replace the row whose problem id === `id` with a fresh row carrying `next` (same id),
   * in place. Falls back to appending if the id isn't in the current working set (e.g. the
   * user scanned an edit for a problem not loaded into this list).
   */
  function replaceRowById(id: string, next: Problem) {
    const i = rowIds.indexOf(id);
    if (i < 0) { addRow(next); return; }
    const old = rows[i]!;
    // Build the replacement row with the same handlers addRow uses.
    const handle = ProblemRow({
      label: next.label,
      latex: next.latex,
      relevance: (next.relevance ?? '') as Relevance,
      onChange: notify,
      onDelete: () => {
        const j = rows.indexOf(handle);
        if (j >= 0) { rows.splice(j, 1); rowIds.splice(j, 1); }
        handle.el.remove();
        notify();
      },
    });
    old.el.replaceWith(handle.el);
    rows[i] = handle;
    rowIds[i] = id;
    makeDraggable(handle);
    renumber();
  }
```

> The `ProblemRow({...})` construction above duplicates the handler wiring inside `addRow`. That duplication is acceptable for one call site, but if you prefer, refactor `addRow` to build the handle via a shared `makeRow(problem)` helper and have both `addRow` and `replaceRowById` use it. Either way, keep `rows`/`rowIds` index-aligned — the drag-reorder code (`makeDraggable`) and `getProblems()` both rely on that alignment.

- [ ] **Step 4: Rewrite `ScanProblemsPage.ts`**

Replace the contents of `packages/client/src/pages/ScanProblemsPage.ts` with the version below. It: takes all stashed files; posts them as `images[]` + `bookId`; maps the `{ resolved, needsSection }` envelope to add/edit/skip cards; renders an ambiguity prompt per `needsSection` page and blocks commit until answered; on answer calls `/refine` with `sectionAnswers`; commits accepted add/edit deltas (carrying `targetId` for edits) to `SCAN_ACCEPTED_KEY`.

```typescript
import { html } from '@/lib/html';
import { renderLatex } from '@/lib/latex';
import { TopBar } from '@/components/TopBar';
import { ChatContainer } from '@/components/ChatContainer';
import { ChatBubble } from '@/components/ChatBubble';
import { ReplyRow } from '@/components/ReplyRow';
import { ThinkingBubble } from '@/components/ThinkingBubble';
import { unstashPhotos } from '@/lib/photo-transfer';
import './ScanProblemsPage.css';

const SCAN_ACCEPTED_KEY = 'qb-scan-accepted';

type Relevance = 'high' | 'medium' | 'low';
interface Delta {
  kind: 'add' | 'edit' | 'skip';
  path?: string;
  canonicalText: string;
  targetId?: string;
  relevance?: Relevance;
}
interface NeedsSection {
  pageIndex: number;
  problems: Array<{ localLabel: string; canonicalText: string }>;
}
interface Envelope {
  resolved: Delta[];
  needsSection: NeedsSection[];
}

interface CardRecord {
  delta: Delta;
  el: HTMLElement;
  accepted: boolean;
}

export function ScanProblemsPage(): HTMLElement {
  const transfer = unstashPhotos();
  const files = transfer?.files ?? [];
  const bookId = transfer?.bookId ?? '';

  // Guard: redirect if no photo context.
  if (files.length === 0 || !bookId) {
    window.location.hash = '#/manage-books';
    return html`<div></div>`;
  }

  const cards: CardRecord[] = [];
  let current: Envelope = { resolved: [], needsSection: [] };
  let pendingPrompts = 0; // unanswered needsSection pages — blocks commit while > 0
  const sectionAnswers: Record<string, string> = {};

  const chat = ChatContainer();

  const applyCount = document.createElement('span');
  applyCount.className = 'sp-apply-count';
  const applyBtn = html`<button class="sp-apply" type="button" disabled>
    Add to book ${applyCount}
  </button>`;

  function syncApply() {
    const n = cards.filter((c) => c.accepted && c.delta.kind !== 'skip').length;
    applyCount.textContent = n ? `· ${n}` : '';
    (applyBtn as HTMLButtonElement).disabled = n === 0 || pendingPrompts > 0;
  }

  // ---- Photo bubbles (one per page) ----
  function addPhotoBubbles() {
    for (const file of files) {
      const msg = ChatBubble('user');
      msg.classList.add('sp-photo');
      const img = document.createElement('img');
      img.className = 'sp-thumb';
      img.alt = 'Photographed problems page';
      img.src = URL.createObjectURL(file);
      msg.appendChild(img);
      chat.append(msg);
    }
    const cap = ChatBubble('user');
    cap.classList.add('sp-cap-bubble');
    const capText = document.createElement('div');
    capText.className = 'sp-cap';
    capText.textContent = `Pull the problems off ${files.length === 1 ? 'this page' : `these ${files.length} pages`}.`;
    cap.appendChild(capText);
    chat.append(cap);
  }

  // ---- Delta card ----
  function makeCard(delta: Delta, beforeText?: string): HTMLElement {
    const card = document.createElement('div');
    card.className = `sp-delta-card sp-${delta.kind}`;

    const tag = document.createElement('span');
    tag.className = `sp-delta-tag sp-tag-${delta.kind}`;
    tag.textContent = delta.kind === 'add' ? 'New' : delta.kind === 'edit' ? 'Edit' : 'Already in book';

    const label = document.createElement('span');
    label.className = 'sp-delta-label';
    label.textContent = delta.path || '—';

    const head = document.createElement('div');
    head.className = 'sp-delta-head';
    head.append(tag, label);

    // Relevance chip (only when the model scored it — i.e. the book had a learning goal).
    if (delta.relevance) {
      const rel = document.createElement('span');
      rel.className = `sp-delta-rel sp-rel-${delta.relevance}`;
      rel.textContent = delta.relevance;
      head.append(rel);
    }

    // skip rows are informational only — no accept toggle, muted, collapsed body.
    if (delta.kind === 'skip') {
      card.appendChild(head);
      cards.push({ delta, el: card, accepted: false });
      return card;
    }

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'sp-delta-toggle on';
    head.append(toggle);
    card.appendChild(head);

    if (delta.kind === 'add') {
      const body = document.createElement('div');
      body.className = 'sp-delta-body';
      renderLatex(body, delta.canonicalText);
      card.appendChild(body);
    } else {
      const before = document.createElement('div');
      before.className = 'sp-delta-before';
      renderLatex(before, beforeText ?? '');
      const arrow = document.createElement('div');
      arrow.className = 'sp-delta-arrow';
      arrow.textContent = '↓';
      const after = document.createElement('div');
      after.className = 'sp-delta-after';
      renderLatex(after, delta.canonicalText);
      card.append(before, arrow, after);
    }

    const rec: CardRecord = { delta, el: card, accepted: true };
    cards.push(rec);
    function syncToggle() {
      card.classList.toggle('sp-rejected', !rec.accepted);
      toggle.textContent = rec.accepted ? 'Added ✓' : 'Add';
      toggle.classList.toggle('on', rec.accepted);
    }
    toggle.addEventListener('click', () => {
      rec.accepted = !rec.accepted;
      syncToggle();
      syncApply();
    });
    syncToggle();
    return card;
  }

  // ---- Render the resolved deltas as a reply ----
  function renderResolved(resolved: Delta[], introText?: string) {
    cards.length = 0;
    const adds = resolved.filter((d) => d.kind === 'add').length;
    const edits = resolved.filter((d) => d.kind === 'edit').length;
    const skips = resolved.filter((d) => d.kind === 'skip').length;

    const msg = ChatBubble('agent');
    const intro = document.createElement('div');
    intro.className = 'sp-delta-intro';
    if (introText) {
      intro.textContent = introText;
    } else {
      const parts: string[] = [];
      if (adds) parts.push(`${adds} new`);
      if (edits) parts.push(`${edits} fix${edits === 1 ? '' : 'es'}`);
      if (skips) parts.push(`${skips} already in the book`);
      intro.textContent = parts.length
        ? `Found ${parts.join(', ')}. Toggle any you don't want, then Add to book.`
        : 'I couldn\'t find any problems on those pages.';
    }
    msg.appendChild(intro);

    const list = document.createElement('div');
    list.className = 'sp-delta-list';
    for (const delta of resolved) {
      // For an edit, look up the existing problem's text to show as "before".
      list.appendChild(makeCard(delta));
    }
    msg.appendChild(list);
    chat.append(msg);
    syncApply();
  }

  // ---- Ambiguity prompt per needsSection page ----
  function renderNeedsSection(pages: NeedsSection[]) {
    pendingPrompts = pages.length;
    for (const page of pages) {
      const msg = ChatBubble('agent');
      msg.classList.add('sp-needs-section');
      const q = document.createElement('div');
      q.className = 'sp-needs-q';
      const nums = page.problems.map((p) => p.localLabel).join(', ');
      q.textContent = `Page ${page.pageIndex + 1} shows problem${page.problems.length === 1 ? '' : 's'} ${nums} with no chapter/section. Which section are these in?`;
      msg.appendChild(q);

      const input = html`<input class="sp-needs-input" type="text" placeholder="e.g. 1.A" />` as HTMLInputElement;
      const go = html`<button class="sp-needs-go" type="button">Set</button>` as HTMLButtonElement;
      const row = document.createElement('div');
      row.className = 'sp-needs-row';
      row.append(input, go);
      msg.appendChild(row);
      chat.append(msg);

      go.addEventListener('click', () => {
        const prefix = input.value.trim();
        if (!prefix) return;
        sectionAnswers[String(page.pageIndex)] = prefix;
        input.disabled = true;
        go.disabled = true;
        go.textContent = 'Set ✓';
        pendingPrompts -= 1;
        syncApply();
        if (pendingPrompts === 0) void refine();
      });
    }
    syncApply();
  }

  // ---- Render a full envelope ----
  function renderEnvelope(env: Envelope, introText?: string) {
    current = env;
    renderResolved(env.resolved, introText);
    if (env.needsSection.length > 0) renderNeedsSection(env.needsSection);
  }

  // ---- Network ----
  function buildForm(extra: Record<string, string> = {}): FormData {
    const form = new FormData();
    form.append('bookId', bookId);
    for (const file of files) form.append('images', file);
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    return form;
  }

  /**
   * POST a multipart form via XHR so we can show real upload progress. fetch() gives
   * no upload-progress events; XHR's upload.onprogress does, so the spinner reflects the
   * actual byte upload and flips to "reading" only once the images are fully received.
   * Resolves with the parsed JSON body on 2xx; rejects with a tagged Error otherwise so
   * the caller can tell an upload failure from a server/parse failure.
   */
  function postWithProgress(
    url: string,
    form: FormData,
    onUploaded: () => void,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      let uploaded = false;
      const markUploaded = () => {
        if (!uploaded) { uploaded = true; onUploaded(); }
      };
      // Fires as bytes go out; lengthComputable guards browsers that don't report total.
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && e.loaded >= e.total) markUploaded();
      });
      // upload.load fires once the request body is fully sent — the definitive
      // "image fully uploaded" signal even when progress isn't length-computable.
      xhr.upload.addEventListener('load', markUploaded);
      xhr.upload.addEventListener('error', () => reject(new Error('upload-failed')));
      xhr.addEventListener('error', () => reject(new Error('network-failed')));
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch { reject(new Error('parse-failed')); }
        } else {
          reject(new Error(`http-${xhr.status}`));
        }
      });
      xhr.send(form);
    });
  }

  async function startExtraction() {
    // Phase 1: uploading the page images. The spinner is explicit about the upload so
    // the user knows the photo is on its way and when it has fully arrived.
    const status = ThinkingBubble(
      files.length === 1 ? 'Uploading your page…' : `Uploading ${files.length} pages…`,
    );
    chat.append(status);
    try {
      const raw = await postWithProgress('/api/extract', buildForm(), () => {
        // Phase 2: images fully uploaded — swap the label to processing.
        setThinkingLabel(status, 'Uploaded ✓ — reading the pages…');
      });
      status.remove();
      renderEnvelope(raw as Envelope);
    } catch (err) {
      status.remove();
      const msg = err instanceof Error && (err.message === 'upload-failed' || err.message === 'network-failed')
        ? 'Upload failed — check your connection and try again.'
        : 'Extraction failed. Go back and try again.';
      renderEnvelope({ resolved: [], needsSection: [] }, msg);
    }
  }

  let refining = false;
  async function refine(note = '') {
    if (refining) return;
    refining = true;
    reply.disable();
    const status = ThinkingBubble('Re-uploading the pages…');
    chat.append(status);
    try {
      const raw = await postWithProgress(
        '/api/extract/refine',
        buildForm({
          currentExtraction: JSON.stringify(current),
          sectionAnswers: JSON.stringify(sectionAnswers),
          note,
        }),
        () => setThinkingLabel(status, 'Uploaded ✓ — placing those problems…'),
      );
      status.remove();
      renderEnvelope(raw as Envelope, 'Here\'s the updated set:');
    } catch {
      status.remove();
      renderEnvelope(current, 'Refinement failed. Add what you have, or try again.');
    } finally {
      refining = false;
      reply.enable();
    }
  }

  /** Swap the visible label of a ThinkingBubble in place (it renders into .thinking-label). */
  function setThinkingLabel(bubble: HTMLElement, label: string) {
    const el = bubble.querySelector('.thinking-label');
    if (el) el.textContent = label;
  }

  const reply = ReplyRow({
    placeholder: 'Refine the problems…',
    onSend(text) { void refine(text); },
  });

  // ---- Commit ----
  applyBtn.addEventListener('click', () => {
    const accepted = cards
      .filter((c) => c.accepted && c.delta.kind !== 'skip')
      .map((c) => ({
        label: c.delta.path || '',
        latex: c.delta.canonicalText,
        ...(c.delta.relevance ? { relevance: c.delta.relevance } : {}),
        ...(c.delta.kind === 'edit' && c.delta.targetId ? { targetId: c.delta.targetId } : {}),
      }));
    sessionStorage.setItem(SCAN_ACCEPTED_KEY, JSON.stringify(accepted));
    window.history.back();
  });

  // ---- Boot ----
  addPhotoBubbles();
  void startExtraction();

  return html`<div class="scan-page">
    ${TopBar({ onBack: () => window.history.back() })}
    ${chat.el}
    <footer class="sp-actions">
      ${reply.el}
      ${applyBtn}
    </footer>
  </div>`;
}
```

> **Note on edit "before" text.** The card's before/after shows the prior transcription. The server knows it (it's the existing problem's `canonicalText`) but the envelope's `edit` delta does not echo it back. For v0, render the before pane empty (as above) or, if you want the before text, look it up client-side from the book's loaded problems if the scan page has them in scope; otherwise leave it empty — the after text + the "Edit" tag already communicate the change. Do not block on this.

- [ ] **Step 5: Add the CSS for skip rows + ambiguity prompts**

Append to `packages/client/src/pages/ScanProblemsPage.css`:

```css
/* Skip rows: muted, no toggle — "already in book". */
.sp-delta-card.sp-skip {
  opacity: 0.6;
}
.sp-delta-tag.sp-tag-skip {
  background: var(--surface-muted, #e9e9ee);
  color: var(--muted, #6b6b76);
}

/* Relevance chip on a delta card head. */
.sp-delta-rel {
  margin-left: auto;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.sp-rel-high { background: #e6f4ea; color: #1b7f3b; }
.sp-rel-medium { background: #fff4e0; color: #9a6700; }
.sp-rel-low { background: #f0f0f3; color: #6b6b76; }

/* Ambiguity prompt bubble. */
.sp-needs-section .sp-needs-q {
  font-weight: 600;
  margin-bottom: 0.5rem;
}
.sp-needs-row {
  display: flex;
  gap: 0.5rem;
}
.sp-needs-input {
  flex: 1;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--border, #d2d2da);
  border-radius: 0.5rem;
  font-size: 0.95rem;
}
.sp-needs-go {
  padding: 0.5rem 0.9rem;
  border: none;
  border-radius: 0.5rem;
  background: var(--accent, #6c4cf0);
  color: #fff;
  font-weight: 600;
}
.sp-needs-go:disabled {
  opacity: 0.6;
}
```

> Match the existing CSS custom-property names in this file/theme (e.g. `--accent`, `--border`, `--muted`). Read the top of `ScanProblemsPage.css` and the theme tokens before finalizing — substitute the project's actual variable names if these differ.

- [ ] **Step 6: Build the client to verify it compiles**

Run: `npm run build -w @qb/client` (or the client's typecheck script if separate; check `packages/client/package.json` scripts).
Expected: PASS — no TypeScript errors. If `@/lib/html`, `ChatBubble`, etc. have signatures that differ from the usage above, reconcile against the originals (the rewrite preserves the original imports and component calls).

- [ ] **Step 7: Run the full typecheck across the workspace**

Run: `npm run typecheck`
Expected: PASS — server + client.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/pages/ScanProblemsPage.ts packages/client/src/pages/ScanProblemsPage.css packages/client/src/components/ProblemsList.ts packages/client/src/lib/photo-transfer.ts packages/client/src/pages/EditBookPage.ts
git commit -m "feat(client): multi-image scan with upload spinner, ambiguity prompts, add/edit/skip + relevance"
```

---

## Task 7: Manual end-to-end verification

No code — drive the real app once to confirm the whole flow. Per the project's e2e-first test preference, this is the acceptance gate for the client work.

**Files:** none.

- [ ] **Step 1: Start the app**

Run the project's dev/run flow (check root `package.json` scripts — typically `npm run dev` to start server + client). If a live LLM key is configured, the real provider runs; otherwise this step needs the Anthropic API key set per the server's provider.

- [ ] **Step 2: Multi-page scan → resolved + an ambiguity prompt → answer → commit**

1. Open a book in edit mode; launch the scan with **2–3 page photos** where at least one page shows bare problem numbers with no chapter/section.
2. Verify the **upload spinner**: while the images upload, the spinner reads "Uploading …"; once the bytes are fully sent it flips to "Uploaded ✓ — reading the pages…", and only then does the model-processing wait begin. (To see the upload phase clearly, throttle the network in dev tools to a slow profile, or use larger photos.) Then a reply appears with add/edit/skip cards AND an ambiguity prompt for the bare-number page. The "Add to book" button is **disabled** while the prompt is unanswered.
   - **Upload-failure path:** with the dev server stopped (or network offline), launch a scan and confirm the page shows "Upload failed — check your connection and try again." rather than a silent hang or a generic extraction error.
3. Answer the section prompt (e.g. `1.A`); verify it calls refine, the prompt resolves, the bare problems reappear as `add` cards under that prefix, and "Add to book" enables.
4. Commit; verify the accepted problems land in the edit-book problem list with their dotted-path labels, then save the book.

- [ ] **Step 3: Relevance preserved (goal-bearing book)**

On a book that **has a learning goal**, run a scan. Verify each add/edit card shows a relevance chip (high/medium/low). Commit, and confirm the relevance dropdown on each new row in the edit-book list reflects the scored value; save and re-open to confirm it persisted. On a book with **no** goal, confirm no relevance chip appears and the flow is otherwise identical. (This is the regression guard for the existing relevance feature.)

- [ ] **Step 4: Re-scan the same pages → all skips**

Re-launch the scan with the same pages. Verify every problem now comes back as a muted **skip** row ("already in book"), and "Add to book" stays disabled (nothing new to add).

- [ ] **Step 5: Record the result**

If all three steps pass, the feature is functionally complete through the spec's build-order step 5. Note any deviation. (Build-order step 6 — the section-tree VIEW + learn-by-node — is intentionally out of scope for this plan; see "Out of scope" below.)

---

## Out of scope (deferred, per the spec)

These are explicitly **not** in this plan and must not be added:

- **Section-tree VIEW + learn-by-node UI** (spec build-order step 6). `buildTree` (Task 3) ships the projection; rendering a tree view in book management and feeding a node's UUIDs into the practice/learn flow is a follow-up plan. Building the function now without a consumer is deliberate — it's small, pure, and tested, and unblocks the next plan.
- **Raising the 5-page cap / Files-API upload.** v0 sends inline base64, ≤5 pages. (Spec "Deferred candidates".)
- **Image-page provenance** — which page a problem came from is not tracked.
- **Token-scoping the existing-problem context** — v0 sends all of the book's problems. (Spec "Scaling note".)
- **A stored `Section` entity or reordering** — the tree is a pure projection of labels.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Multi-page upload (≤5) → Task 4 (`upload.array('images', 5)`, 6th-image 400 test).
- Dotted-path labels + ambiguity → Tasks 1 (prompt), 2 (validator allows path/needsSection), 6 (client prompts).
- Derived section tree → Task 3 (`buildTree` + test). *View* deferred (documented in Out of scope).
- Stable identity / non-unique path → carried by the existing `Question.label` + `createdAt`; `buildTree` orders co-path problems by `createdAt` (Task 3 test).
- add/edit/skip + dedupe → Tasks 1 (prompt rule), 2 (validator), 4 (route + UAT skip/add), 6 (client rendering + commit with `targetId`).
- `extractRouter(provider, store)` + `bookId` + existing-problem context → Task 4.
- `/refine` with `sectionAnswers` → Task 4 (refine route + transcript test) + Task 5 (UAT ambiguity round-trip flow 7b) + Task 6 (client calls it). **Covered by UAT** per the user's request: flow 7b drives extract → needsSection → refine(sectionAnswers) → resolved → commit end-to-end through the real app.
- Cross-field validation as 502 → Task 2 + Task 4 test.
- Error matrix (400 no-images/missing-bookId, 404 book, 502 provider/invalid) → Task 4 tests (both `/extract` and `/refine`).
- The dead `'edit'` delta becomes real → Task 6 (edit card + targetId commit) + Task 6 Step 3 ProblemsList changes.
- **Upload feedback / "image fully uploaded" spinner** (user request) → Task 6 (`postWithProgress` XHR helper: "Uploading…" → "Uploaded ✓ — reading…", distinct upload-failure message) + Task 7 Step 2 (manual verification of both the success transition and the upload-failure path).
- **Relevance feature — PRESERVED, NOT REGRESSED** (already-shipped feature the spec predates) → Task 1 (`relevanceInstruction` kept + folded into `buildExtractionPrompt(existing, learningGoal)`; `relevance` enum added to the envelope schema), Task 2 (`Delta.relevance` + validator carries valid values, drops invalid, never on skip — 2 unit cases), Task 4 (route sources `learningGoal` from the book record; relevance route test asserts goal-on vs goal-off), Task 5 (UAT flow 7c: scored extract → commit → persisted on the stored question), Task 6 (relevance chip on cards + carried through commit; the existing `Problem`/`getProblems`/batch-PUT path persists it unchanged), Task 7 Step 3 (manual regression guard). **Covered by UAT** end-to-end per the user's request.

**Placeholder scan:** every code step contains complete code. The "adapt to the real structure" notes (CSS variable names in Task 6 Step 5; the optional `makeRow` refactor in Step 3) point at specific verifications, not vague TODOs. The earlier ProblemsList-row uncertainty is resolved: Step 3 now matches the real parallel-array (`rows`/`rowIds`) structure and the setter-less `ProblemRowHandle`, using a delete+re-add replace.

**Type consistency:** `validateExtractionEnvelope(raw, existingIds, pageCount)` signature is identical across Task 2 (definition), Task 2 test, and Task 4 (call sites). `ExtractionEnvelope`/`Delta`/`NeedsSection` shapes match between server (Task 2) and client (Task 6), including the added `relevance?: Relevance`. `buildExtractionPrompt(existing, learningGoal?)` / `renderExistingProblems` / `relevanceInstruction` / `extractionEnvelopeSchema` names match between Task 1 and Task 4. `Relevance = 'high'|'medium'|'low'` matches the domain type (server) and the local client alias. `TreeProblem`/`TreeNode`/`buildTree` match between Task 3 and its test. The scan-accepted item shape `{ label, latex, relevance?, targetId? }` matches between Task 6's `ScanProblemsPage` commit, the `Problem` type, and `ProblemsList.checkForReturnedProblems`.

**Relevance cross-check (the regression that prompted this revision):** the plan no longer deletes relevance. `extract.ts` (lib) is still removed, but its relevance-validation logic is re-homed in `extraction-delta.ts` (Task 2). The contract keeps `relevanceInstruction`. The routes source `learningGoal` from the book (no lost client field). The commit path was already relevance-aware and is reused. Net: relevance survives and is exercised by a unit test, a route test, a UAT flow, and a manual step.
