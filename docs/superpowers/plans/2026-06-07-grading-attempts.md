# Grading — Attempts & the Learn tab Implementation Plan

> **⚠️ SUPERSEDED — DO NOT EXECUTE.** This plan was written from the typed-answer-first
> grading spec. The product owner clarified that **photo scanning of the handwritten
> answer is the primary feature**; typed answers are secondary. The design was redone in
> [2026-06-07-grading-photo-answers-design.md](../specs/2026-06-07-grading-photo-answers-design.md),
> and a replacement plan will be written from it. Kept for reference only — much of the
> server scaffolding (provider generalization, attempts repo, learn/next, skip/snooze)
> still applies, but the answer/transcribe flow differs.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working solve → grade → rate loop in the Learn tab for typed answers, where every LLM turn carries a recommended grade and the user commits a final Attempt.

**Architecture:** Generalize `LlmProvider` to a conversational `complete`/`completeStructured` interface (with a lazy `ImageRef` abstraction), refactor the existing image extraction onto it, add an `Attempt` entity with JSON storage, and add stateless full-transcript grading plus skip/snooze state and a `learn/next` suggestion service. The client gets a Learn tab with a suggested-next card, a book→chapter→question navigator, and a grading chat view.

**Tech Stack:** TypeScript (strict ESM), Express, Vitest + supertest, `@anthropic-ai/sdk`, Vite + vanilla TS client, KaTeX.

**Source spec:** `docs/superpowers/specs/2026-06-07-grading-attempts-design.md`

---

## File Structure

**Server — new files**
- `packages/server/src/llm/image-ref.ts` — `ImageRef` interface + `fileImage`/`bufferImage` constructors.
- `packages/server/src/llm/grading-contract.ts` — grading prompt builder + grading-turn schema.
- `packages/server/src/routes/grade.ts` — `POST /api/questions/:id/grade`.
- `packages/server/src/routes/attempts.ts` — `POST` + `GET /api/questions/:id/attempts`.
- `packages/server/src/services/learn-next.ts` — suggested-next query.
- Test files co-located as `*.test.ts` per task.

**Server — modified files**
- `packages/server/src/llm/provider.ts` — generalize `LlmProvider`; add `Role`/`Message`/`CompleteOpts`; keep `LlmError`.
- `packages/server/src/llm/extraction-contract.ts` — always-present `label` guidance + position fallback.
- `packages/server/src/llm/anthropic-api-provider.ts` — implement `complete`/`completeStructured`; re-express extraction.
- `packages/server/src/llm/fake-provider.ts` — implement `complete`/`completeStructured`; keep extraction behavior.
- `packages/server/src/domain/types.ts` — add `Grade`, `Attempt`; add `skipped`/`snoozedUntil` to `Question`.
- `packages/server/src/storage/store.ts` — open an `attempts` collection.
- `packages/server/src/routes/questions.ts` — widen PATCH for `skipped`/`snoozedUntil`.
- `packages/server/src/index.ts` — mount grade, attempts, and learn routers.

**Client — modified files**
- `packages/client/src/api/types.ts` — `Grade`, `Attempt`, `Message`, `LearnNext`; `skipped`/`snoozedUntil` on `Question`.
- `packages/client/src/api/client.ts` — `gradeTurn`, `createAttempt`, `listAttempts`, `patchQuestionState`, `getLearnNext`.
- `packages/client/src/tabs/learn.ts` — replace stub with suggested-next card + navigator + grading view.
- `packages/client/src/styles.css` — style hooks for card/chat/badge.

---

## Conventions to follow (read before starting)

- **Strict TS, ESM.** `import`/`export` only, `.js` extension on relative imports. `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` are on — build optional fields conditionally (`...(x !== undefined ? { x } : {})`), never assign `undefined` to an optional property.
- **Repository contract** (`storage/repository.ts`): `create(entity)` takes a fully-formed entity with `id` already set; `getAll()`/`getById()` return deep clones.
- **Ids/time:** `newId()` and `nowIso()` from `domain/ids.js`.
- **Route tests** use `supertest` against `createApp(store, provider, imageStore)` over a `mkdtemp` data dir, with `FakeProvider` and `ImageStore`. Mirror `routes/questions.test.ts`.
- **Run a single test file:** `npm test -- <path>` from repo root. Full suite: `npm test`. Types: `npm run typecheck`.
- **Commits:** multi-line messages via `git commit -F <file>` (PowerShell mangles here-strings). Commit directly to `main` (no feature branches pre-v1).

---

# SLIVER 1 — Generalize `LlmProvider`, refactor extraction onto it

*Observable when done: image extraction still works in the browser; tests green.*

### Task 1: Add the `ImageRef` abstraction

**Files:**
- Create: `packages/server/src/llm/image-ref.ts`
- Test: `packages/server/src/llm/image-ref.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/llm/image-ref.test.ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bufferImage, fileImage } from './image-ref.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-imageref-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ImageRef', () => {
  it('bufferImage carries its mimeType and returns its bytes', async () => {
    const ref = bufferImage(Buffer.from('hello'), 'image/png');
    expect(ref.mimeType).toEqual('image/png');
    expect((await ref.load()).toString()).toEqual('hello');
  });

  it('fileImage reads bytes from disk lazily', async () => {
    const path = join(dir, 'a.jpg');
    await writeFile(path, 'jpegbytes');
    const ref = fileImage(path, 'image/jpeg');
    expect(ref.mimeType).toEqual('image/jpeg');
    expect((await ref.load()).toString()).toEqual('jpegbytes');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/server/src/llm/image-ref.test.ts`
Expected: FAIL — cannot find module `./image-ref.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/server/src/llm/image-ref.ts
import { readFile } from 'node:fs/promises';

/** Accepted image media types across providers. */
export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

/**
 * A reference to image bytes the provider resolves only when it serializes a turn.
 * Decouples bytes from location: file now, in-memory now, S3 later — the provider
 * never branches on the kind, it just calls `load()`.
 */
export interface ImageRef {
  mimeType: ImageMimeType;
  load(): Promise<Buffer>;
}

/** An ImageRef whose bytes are read from an absolute path on `load()`. */
export function fileImage(absolutePath: string, mimeType: ImageMimeType): ImageRef {
  return { mimeType, load: () => readFile(absolutePath) };
}

/** An ImageRef backed by an in-memory buffer (no disk read). */
export function bufferImage(bytes: Buffer, mimeType: ImageMimeType): ImageRef {
  return { mimeType, load: () => Promise.resolve(bytes) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/server/src/llm/image-ref.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/llm/image-ref.ts packages/server/src/llm/image-ref.test.ts
git commit -F <commit-msg-file>
```
Commit message: `feat: add ImageRef with fileImage/bufferImage constructors`

---

### Task 2: Generalize the `LlmProvider` interface

This changes the interface shape. The two providers and the extraction route still reference the old `extractQuestionsFromImage`; we keep that method on the interface for now (so the codebase keeps compiling) and **add** the two new methods. Extraction is moved onto the new methods in Task 3–4, and `extractQuestionsFromImage` is removed from the interface in Task 4.

**Files:**
- Modify: `packages/server/src/llm/provider.ts`

- [ ] **Step 1: Replace the interface contents**

Replace the whole file with:

```ts
// packages/server/src/llm/provider.ts
import type { ImageRef } from './image-ref.js';

/** One question extracted from a source, in the canonical LaTeX/markdown form. */
export interface ExtractedQuestion {
  /** LaTeX/markdown — source of truth. */
  canonicalText: string;
  /** Book's own numbering, e.g. "2.4", if the source showed it. */
  label?: string;
}

export type Role = 'user' | 'assistant';

export interface Message {
  role: Role;
  text: string;
  /** Unused by grading; carried for Phase 1 photo transcription later. */
  images?: ImageRef[];
}

/** Provider-specific knobs (model, timeout, …). All optional. */
export interface CompleteOpts {
  model?: string;
  timeoutMs?: number;
}

/** The LLM layer's conversational operations. Stateless: caller replays the transcript. */
export interface LlmProvider {
  /** Free-text completion of a conversation. */
  complete(conversation: Message[], opts?: CompleteOpts): Promise<string>;
  /** Schema-constrained completion; the provider validates/retries against `schema`. */
  completeStructured<T>(conversation: Message[], schema: object, opts?: CompleteOpts): Promise<T>;
}

/** Raised by a provider on backend failure (request failed, bad/invalid output). */
export class LlmError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LlmError';
  }
}
```

Note: `ExtractionRequest` is gone — extraction now goes through `completeStructured`. `ExtractedQuestion` stays (still used by the extraction contract/route).

- [ ] **Step 2: Run typecheck to see the expected breakage**

Run: `npm run typecheck`
Expected: FAIL — `anthropic-api-provider.ts`, `fake-provider.ts`, and `routes/questions.ts` reference removed `ExtractionRequest`/`extractQuestionsFromImage`. These are fixed in Tasks 3–4. (Do not commit yet — this task is committed together with Task 3 since the tree must compile.)

---

### Task 3: Implement the new methods on `FakeProvider`

**Files:**
- Modify: `packages/server/src/llm/fake-provider.ts`
- Modify: `packages/server/src/llm/fake-provider.test.ts`

- [ ] **Step 1: Write the failing test**

Replace `packages/server/src/llm/fake-provider.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { FakeProvider } from './fake-provider.js';
import { LlmError } from './provider.js';

describe('FakeProvider', () => {
  it('complete returns the configured text', async () => {
    const p = new FakeProvider({ completeText: 'hello' });
    expect(await p.complete([{ role: 'user', text: 'hi' }])).toEqual('hello');
  });

  it('completeStructured returns the configured object', async () => {
    const obj = { critiqueText: 'good', recommendedGrade: 'partial' };
    const p = new FakeProvider({ structured: obj });
    expect(await p.completeStructured([{ role: 'user', text: 'hi' }], {})).toEqual(obj);
  });

  it('records the last conversation it was given', async () => {
    const p = new FakeProvider();
    await p.complete([{ role: 'user', text: 'q1' }, { role: 'assistant', text: 'a1' }]);
    expect(p.lastConversation).toHaveLength(2);
    expect(p.lastConversation[1]).toMatchObject({ role: 'assistant', text: 'a1' });
  });

  it('failWith makes the next call reject', async () => {
    const p = new FakeProvider();
    p.failWith(new LlmError('boom'));
    await expect(p.complete([{ role: 'user', text: 'x' }])).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/server/src/llm/fake-provider.test.ts`
Expected: FAIL — `FakeProvider` constructor signature/methods don't match.

- [ ] **Step 3: Rewrite `FakeProvider`**

Replace `packages/server/src/llm/fake-provider.ts` with:

```ts
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
      // (Task 4) has a usable shape when a test doesn't configure one.
      return { questions: [] } as T;
    }
    return this.config.structured as T;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/server/src/llm/fake-provider.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit (provider interface + fake together)**

```bash
git add packages/server/src/llm/provider.ts packages/server/src/llm/fake-provider.ts packages/server/src/llm/fake-provider.test.ts
git commit -F <commit-msg-file>
```
Commit message: `refactor: generalize LlmProvider to complete/completeStructured`

(Typecheck still fails until Task 4 — that's expected; the anthropic provider and extraction route are next.)

---

### Task 4: Re-express extraction on `completeStructured` (Anthropic provider + route)

The extraction *contract* (prompt + schema) and the *shape* `{ questions: [...] }` are unchanged. We move the orchestration: a thin `extractQuestions` helper builds a single user `Message` carrying a `bufferImage`, calls `completeStructured`, and validates the envelope. The route calls this helper with `file.buffer` directly (no disk re-read).

**Files:**
- Modify: `packages/server/src/llm/anthropic-api-provider.ts`
- Modify: `packages/server/src/llm/anthropic-api-provider.test.ts`
- Create: `packages/server/src/llm/extract.ts` (helper + validators, provider-agnostic)
- Create: `packages/server/src/llm/extract.test.ts`
- Modify: `packages/server/src/routes/questions.ts`
- Modify: `packages/server/src/routes/questions-extract.test.ts`

- [ ] **Step 1: Write the failing test for the provider-agnostic extract helper**

```ts
// packages/server/src/llm/extract.test.ts
import { describe, expect, it } from 'vitest';
import { bufferImage } from './image-ref.js';
import { extractQuestions, parseExtractionResult } from './extract.js';
import { FakeProvider } from './fake-provider.js';
import { LlmError } from './provider.js';

describe('parseExtractionResult', () => {
  it('keeps canonicalText, includes label when non-blank, drops blank label', () => {
    const out = parseExtractionResult({
      questions: [
        { canonicalText: 'a', label: '2.4' },
        { canonicalText: 'b', label: '  ' },
        { canonicalText: 'c' },
      ],
    });
    expect(out).toEqual([
      { canonicalText: 'a', label: '2.4' },
      { canonicalText: 'b' },
      { canonicalText: 'c' },
    ]);
  });

  it('throws on a non-array envelope', () => {
    expect(() => parseExtractionResult({ questions: 'nope' })).toThrow(LlmError);
  });

  it('throws on an item missing canonicalText', () => {
    expect(() => parseExtractionResult({ questions: [{ label: '1' }] })).toThrow(LlmError);
  });
});

describe('extractQuestions', () => {
  it('passes a single image-bearing user message and returns parsed questions', async () => {
    const provider = new FakeProvider({ structured: { questions: [{ canonicalText: 'x' }] } });
    const out = await extractQuestions(provider, bufferImage(Buffer.from('img'), 'image/png'));
    expect(out).toEqual([{ canonicalText: 'x' }]);
    expect(provider.lastConversation).toHaveLength(1);
    expect(provider.lastConversation[0]?.images).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/server/src/llm/extract.test.ts`
Expected: FAIL — cannot find module `./extract.js`.

- [ ] **Step 3: Write the extract helper**

```ts
// packages/server/src/llm/extract.ts
import { extractionPrompt, extractionSchema } from './extraction-contract.js';
import type { ImageRef } from './image-ref.js';
import { LlmError, type ExtractedQuestion, type LlmProvider } from './provider.js';

/** The structured-output schema for extraction: a top-level object wrapping the array. */
const extractionEnvelopeSchema = {
  type: 'object',
  properties: { questions: extractionSchema },
  required: ['questions'],
  additionalProperties: false,
} as const;

/** Validate one raw item into an ExtractedQuestion (label omitted when absent/blank). */
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

/** Validate the parsed `{ questions: [...] }` envelope into ExtractedQuestion[]. */
export function parseExtractionResult(raw: unknown): ExtractedQuestion[] {
  if (typeof raw !== 'object' || raw === null) {
    throw new LlmError('extraction result is not an object');
  }
  const { questions } = raw as Record<string, unknown>;
  if (!Array.isArray(questions)) {
    throw new LlmError('extraction result has no questions array');
  }
  return questions.map(toExtractedQuestion);
}

/**
 * Extract questions from a single image via the conversational interface: one user
 * message carrying the image + the central extraction prompt, completed against the
 * extraction schema, then validated. Provider-agnostic.
 */
export async function extractQuestions(
  provider: LlmProvider,
  image: ImageRef,
): Promise<ExtractedQuestion[]> {
  const result = await provider.completeStructured<unknown>(
    [{ role: 'user', text: extractionPrompt, images: [image] }],
    extractionEnvelopeSchema,
  );
  return parseExtractionResult(result);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/server/src/llm/extract.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Rewrite `AnthropicApiProvider` to the new interface**

Replace `packages/server/src/llm/anthropic-api-provider.ts` with:

```ts
import Anthropic from '@anthropic-ai/sdk';
import {
  type CompleteOpts,
  LlmError,
  type LlmProvider,
  type Message,
} from './provider.js';

/** Hard cap on a single request. Without this the SDK's 10-minute default (retried
 *  up to 2×) could hang the HTTP request for tens of minutes; a timeout → 502. */
const REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Build the Anthropic message content for one of our Messages (text + any images). */
async function toApiContent(message: Message): Promise<Anthropic.ContentBlockParam[]> {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const image of message.images ?? []) {
    const bytes = await image.load();
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mimeType, data: bytes.toString('base64') },
    });
  }
  blocks.push({ type: 'text', text: message.text });
  return blocks;
}

async function toApiMessages(conversation: Message[]): Promise<Anthropic.MessageParam[]> {
  return Promise.all(
    conversation.map(async (m) => ({ role: m.role, content: await toApiContent(m) })),
  );
}

/** Pull the first text block out of a response, or fail fast on refusal/truncation. */
function textFromMessage(message: Anthropic.Message): string {
  if (message.stop_reason === 'refusal') throw new LlmError('request refused');
  if (message.stop_reason === 'max_tokens') {
    throw new LlmError('response truncated — increase max_tokens');
  }
  const textBlock = message.content.find((block) => block.type === 'text');
  if (textBlock === undefined) throw new LlmError('no text content in API response');
  return textBlock.text;
}

/** Direct Anthropic API backend. The client is injectable for testing. */
export class AnthropicApiProvider implements LlmProvider {
  constructor(private readonly client: Anthropic = new Anthropic()) {}

  async complete(conversation: Message[], opts?: CompleteOpts): Promise<string> {
    const messages = await toApiMessages(conversation);
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(
        { model: opts?.model ?? DEFAULT_MODEL, max_tokens: 8000, messages },
        { timeout: opts?.timeoutMs ?? REQUEST_TIMEOUT_MS, maxRetries: 2 },
      );
    } catch (err) {
      throw new LlmError('anthropic API request failed', { cause: err });
    }
    return textFromMessage(message);
  }

  async completeStructured<T>(
    conversation: Message[],
    schema: object,
    opts?: CompleteOpts,
  ): Promise<T> {
    const messages = await toApiMessages(conversation);
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(
        {
          model: opts?.model ?? DEFAULT_MODEL,
          max_tokens: 8000,
          messages,
          output_config: { format: { type: 'json_schema', schema } },
        },
        { timeout: opts?.timeoutMs ?? REQUEST_TIMEOUT_MS, maxRetries: 2 },
      );
    } catch (err) {
      throw new LlmError('anthropic API request failed', { cause: err });
    }
    const text = textFromMessage(message);
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new LlmError('API response was not valid JSON', { cause: err });
    }
  }
}
```

- [ ] **Step 6: Rewrite the Anthropic provider test**

Replace `packages/server/src/llm/anthropic-api-provider.test.ts` with:

```ts
import { describe, expect, it, vi } from 'vitest';
import { AnthropicApiProvider } from './anthropic-api-provider.js';
import { bufferImage } from './image-ref.js';
import { LlmError } from './provider.js';

/** Build a fake Anthropic client whose messages.create returns a canned message. */
function fakeClient(message: unknown) {
  return { messages: { create: vi.fn().mockResolvedValue(message) } } as never;
}

describe('AnthropicApiProvider', () => {
  it('complete returns the first text block', async () => {
    const provider = new AnthropicApiProvider(
      fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi there' }] }),
    );
    expect(await provider.complete([{ role: 'user', text: 'hi' }])).toEqual('hi there');
  });

  it('completeStructured parses the JSON text block', async () => {
    const provider = new AnthropicApiProvider(
      fakeClient({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"recommendedGrade":"correct"}' }],
      }),
    );
    const out = await provider.completeStructured<{ recommendedGrade: string }>(
      [{ role: 'user', text: 'grade' }],
      {},
    );
    expect(out).toEqual({ recommendedGrade: 'correct' });
  });

  it('serializes an image-bearing message into a base64 image block', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{}' }],
    });
    const provider = new AnthropicApiProvider({ messages: { create } } as never);
    await provider.completeStructured(
      [{ role: 'user', text: 'extract', images: [bufferImage(Buffer.from('img'), 'image/png')] }],
      {},
    );
    const sent = create.mock.calls[0][0].messages[0].content;
    expect(sent[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png' } });
    expect(sent[1]).toMatchObject({ type: 'text', text: 'extract' });
  });

  it('throws LlmError on refusal', async () => {
    const provider = new AnthropicApiProvider(fakeClient({ stop_reason: 'refusal', content: [] }));
    await expect(provider.complete([{ role: 'user', text: 'x' }])).rejects.toThrow(LlmError);
  });
});
```

- [ ] **Step 7: Update the extraction route to use the helper + `bufferImage`**

In `packages/server/src/routes/questions.ts`:

Replace the import line:
```ts
import { extractionPrompt, extractionSchema } from '../llm/extraction-contract.js';
import { LlmError, type LlmProvider } from '../llm/provider.js';
```
with:
```ts
import { bufferImage } from '../llm/image-ref.js';
import { extractQuestions } from '../llm/extract.js';
import { LlmError, type LlmProvider } from '../llm/provider.js';
```

Replace the extraction call (the `try { extracted = await provider.extractQuestionsFromImage({...}); }` block) with:
```ts
    let extracted;
    try {
      extracted = await extractQuestions(provider, bufferImage(file.buffer, file.mimetype as never));
    } catch (err) {
      if (err instanceof LlmError) {
        res.status(502).json({ error: 'extraction failed' });
        return;
      }
      throw err;
    }
```

Note: the image is still saved to disk first (unchanged) for retention; we pass `file.buffer` to the provider to avoid a redundant re-read. `file.mimetype` was already validated by the existing `imageExt(file.mimetype)` guard above, so it is one of the four accepted types.

- [ ] **Step 8: Run the extraction route test (it should still pass unchanged)**

Run: `npm test -- packages/server/src/routes/questions-extract.test.ts`
Expected: PASS. If it constructs `FakeProvider` with a positional `ExtractedQuestion[]`, update it to `new FakeProvider({ structured: { questions: [{ canonicalText: '...' }] } })`. Make the minimal edit needed so the test passes against the new envelope shape, keeping its assertions.

- [ ] **Step 9: Full typecheck + suite green**

Run: `npm run typecheck && npm test`
Expected: PASS across the board. (Old `parseExtractionResult`/`mediaTypeForPath` imports from `anthropic-api-provider.js` no longer exist; if any test imported them, repoint to `extract.js` or delete the now-irrelevant assertion.)

- [ ] **Step 10: Verify in the browser**

Run: `npm run dev`, open http://localhost:5173, go to Manage → a chapter → extract from an image. Confirm extraction still creates questions.

- [ ] **Step 11: Commit**

```bash
git add packages/server/src/llm/ packages/server/src/routes/questions.ts packages/server/src/routes/questions-extract.test.ts
git commit -F <commit-msg-file>
```
Commit message: `refactor: drive image extraction through completeStructured`

---

# SLIVER 2 — Label-extraction improvement

*Observable when done: newly extracted questions always carry a label.*

### Task 5: Strengthen the extraction prompt for always-present labels

**Files:**
- Modify: `packages/server/src/llm/extraction-contract.ts`
- Create/Modify: `packages/server/src/llm/extraction-contract.test.ts`

- [ ] **Step 1: Write the failing test (prompt-content assertions)**

```ts
// packages/server/src/llm/extraction-contract.test.ts
import { describe, expect, it } from 'vitest';
import { extractionPrompt, extractionSchema } from './extraction-contract.js';

describe('extractionPrompt', () => {
  it('still forbids solving/answering/hinting', () => {
    expect(extractionPrompt).toMatch(/do not solve/i);
  });

  it('instructs the agent to always produce a label', () => {
    expect(extractionPrompt).toMatch(/always/i);
    expect(extractionPrompt).toMatch(/label/i);
  });

  it('describes a position-based fallback when no real label exists', () => {
    expect(extractionPrompt).toMatch(/#1|ordinal|fallback/i);
  });

  it('schema keeps canonicalText required and label a string', () => {
    expect(extractionSchema.items.required).toContain('canonicalText');
    expect(extractionSchema.items.properties.label.type).toEqual('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/server/src/llm/extraction-contract.test.ts`
Expected: FAIL — the "always"/fallback assertions don't match the current prompt.

- [ ] **Step 3: Update the prompt**

Replace the `extractionPrompt` array in `extraction-contract.ts` with:

```ts
export const extractionPrompt = [
  'You are extracting questions from a single photographed page of a textbook.',
  'Identify each DISTINCT question or exercise on the page.',
  'For each one, transcribe it faithfully into LaTeX/markdown as `canonicalText`.',
  'ALWAYS provide a referenceable `label` for every question. Prefer a real label drawn',
  'from any signal on the page: the question\'s own visible number, "Problem N" / "Exercise N"',
  'phrasing, section or chapter numbers, or a page header/footer (top or bottom of the page).',
  'Only when no real label can be found, fall back to a position-based label: an ordinal',
  'within this batch ("#1", "#2", …), or "p.<page>-<n>" when a page number is visible.',
  'Do NOT solve, answer, hint at, or comment on any question. Transcribe only.',
  'Preserve mathematical notation exactly using LaTeX. Do not invent questions that are not on the page.',
  'Return the questions as a JSON array matching the provided schema.',
].join('\n');
```

Leave `extractionSchema` unchanged (label stays optional in the type for manual creation; the prompt is what makes extraction always fill it).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/server/src/llm/extraction-contract.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/llm/extraction-contract.ts packages/server/src/llm/extraction-contract.test.ts
git commit -F <commit-msg-file>
```
Commit message: `feat: extraction always yields a referenceable label`

---

# SLIVER 3 — `Attempt` model + repository + `/attempts` routes

*Observable when done: an attempt can be created and listed via the API.*

### Task 6: Add domain types — `Grade`, `Attempt`, and `Question` skip/snooze

**Files:**
- Modify: `packages/server/src/domain/types.ts`

- [ ] **Step 1: Add the types**

Append to `packages/server/src/domain/types.ts`:

```ts
/** Grade vocabulary. `partial` ⇒ the answer is ≥70% of the way there. */
export type Grade = 'correct' | 'partial' | 'incorrect';

/** A committed grading attempt — final state only; the in-flight chat is not stored. */
export interface Attempt {
  id: string;
  questionId: string;
  /** User's final typed answer (plain text). */
  answerText: string;
  /** Last grade the LLM recommended. */
  recommendedGrade: Grade;
  /** User's final decision (accept or override). */
  rating: Grade;
  /** The LLM's final critique message. */
  critiqueText: string;
  createdAt: string;
}
```

And add the two optional fields to `Question` (after `nextReviewDate?`):

```ts
  /** "Skip" — never suggest this question again. */
  skipped?: boolean;
  /** "Not now" — suggest again only after this time. */
  snoozedUntil?: string;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (purely additive).

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/domain/types.ts
git commit -F <commit-msg-file>
```
Commit message: `feat: add Grade/Attempt types and Question skip/snooze fields`

---

### Task 7: Open the `attempts` collection in `Store`

**Files:**
- Modify: `packages/server/src/storage/store.ts`
- Modify: `packages/server/src/storage/store.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/server/src/storage/store.test.ts` (follow the existing pattern in that file for opening a store over a temp dir):

```ts
it('opens an attempts collection that round-trips', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qb-store-attempts-'));
  try {
    const store = await Store.open(dir);
    const created = store.attempts.create({
      id: 'a1',
      questionId: 'q1',
      answerText: 'x',
      recommendedGrade: 'partial',
      rating: 'correct',
      critiqueText: 'nice',
      createdAt: '2026-06-07T00:00:00.000Z',
    });
    expect(created.id).toEqual('a1');
    expect(store.attempts.getAll()).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

(If `store.test.ts` lacks the `mkdtemp`/`rm`/`tmpdir`/`join` imports, add them at the top to match `questions.test.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/server/src/storage/store.test.ts`
Expected: FAIL — `store.attempts` does not exist.

- [ ] **Step 3: Add the collection**

Edit `packages/server/src/storage/store.ts`:

```ts
import type { Attempt, Book, Chapter, Question } from '../domain/types.js';
```

Add `attempts` to the constructor and `open`:

```ts
  private constructor(
    readonly books: Repository<Book>,
    readonly chapters: Repository<Chapter>,
    readonly questions: Repository<Question>,
    readonly attempts: Repository<Attempt>,
  ) {}

  static async open(dataDir: string): Promise<Store> {
    const [books, chapters, questions, attempts] = await Promise.all([
      JsonCollection.open<Book>(join(dataDir, 'books.json')),
      JsonCollection.open<Chapter>(join(dataDir, 'chapters.json')),
      JsonCollection.open<Question>(join(dataDir, 'questions.json')),
      JsonCollection.open<Attempt>(join(dataDir, 'attempts.json')),
    ]);
    return new Store(books, chapters, questions, attempts);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/server/src/storage/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/storage/store.ts packages/server/src/storage/store.test.ts
git commit -F <commit-msg-file>
```
Commit message: `feat: open attempts JSON collection in Store`

---

### Task 8: `/api/questions/:id/attempts` — create + list

**Files:**
- Create: `packages/server/src/routes/attempts.ts`
- Create: `packages/server/src/routes/attempts.test.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Write the failing route test**

```ts
// packages/server/src/routes/attempts.test.ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { FakeProvider } from '../llm/fake-provider.js';
import { ImageStore } from '../storage/images.js';
import { Store } from '../storage/store.js';

let dir: string;
let app: Awaited<ReturnType<typeof createApp>>;
let questionId: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-attempts-'));
  const store = await Store.open(dir);
  app = createApp(store, new FakeProvider(), new ImageStore(dir));
  const bookId = (await request(app).post('/api/books').send({ title: 'B' })).body.id;
  const chapterId = (await request(app).post(`/api/books/${bookId}/chapters`).send({ title: 'C' }))
    .body.id;
  questionId = (
    await request(app).post(`/api/chapters/${chapterId}/questions`).send({ canonicalText: 'q' })
  ).body.id;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const body = {
  answerText: 'my answer',
  recommendedGrade: 'partial',
  rating: 'correct',
  critiqueText: 'close enough',
};

describe('attempts routes', () => {
  it('un-attempted question lists empty', async () => {
    const res = await request(app).get(`/api/questions/${questionId}/attempts`);
    expect(res.status).toEqual(200);
    expect(res.body).toEqual([]);
  });

  it('creates an attempt (201) and lists it', async () => {
    const created = await request(app).post(`/api/questions/${questionId}/attempts`).send(body);
    expect(created.status).toEqual(201);
    expect(created.body).toMatchObject({ questionId, rating: 'correct', recommendedGrade: 'partial' });
    expect(created.body.id).toBeTruthy();
    const list = await request(app).get(`/api/questions/${questionId}/attempts`);
    expect(list.body).toHaveLength(1);
  });

  it('404 when the question does not exist', async () => {
    const res = await request(app).post('/api/questions/nope/attempts').send(body);
    expect(res.status).toEqual(404);
  });

  it('400 on missing answerText', async () => {
    const res = await request(app)
      .post(`/api/questions/${questionId}/attempts`)
      .send({ ...body, answerText: '' });
    expect(res.status).toEqual(400);
  });

  it('400 on an invalid grade value', async () => {
    const res = await request(app)
      .post(`/api/questions/${questionId}/attempts`)
      .send({ ...body, rating: 'amazing' });
    expect(res.status).toEqual(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/server/src/routes/attempts.test.ts`
Expected: FAIL — router not mounted / module missing.

- [ ] **Step 3: Write the router**

```ts
// packages/server/src/routes/attempts.ts
import { Router } from 'express';
import { newId, nowIso } from '../domain/ids.js';
import type { Attempt, Grade } from '../domain/types.js';
import type { Store } from '../storage/store.js';

const GRADES: readonly Grade[] = ['correct', 'partial', 'incorrect'];

function isGrade(value: unknown): value is Grade {
  return typeof value === 'string' && (GRADES as readonly string[]).includes(value);
}

/** Nested under /api/questions/:id/attempts — list + create (final-state only). */
export function questionAttemptsRouter(store: Store): Router {
  const router = Router({ mergeParams: true });

  router.get('/', (req, res) => {
    const questionId = (req.params as { id: string }).id;
    if (!store.questions.getById(questionId)) {
      res.status(404).json({ error: 'question not found' });
      return;
    }
    res.json(store.attempts.getAll().filter((a) => a.questionId === questionId));
  });

  router.post('/', (req, res) => {
    const questionId = (req.params as { id: string }).id;
    if (!store.questions.getById(questionId)) {
      res.status(404).json({ error: 'question not found' });
      return;
    }
    const { answerText, recommendedGrade, rating, critiqueText } = req.body ?? {};
    if (typeof answerText !== 'string' || answerText.trim() === '') {
      res.status(400).json({ error: 'answerText is required' });
      return;
    }
    if (!isGrade(recommendedGrade) || !isGrade(rating)) {
      res.status(400).json({ error: 'recommendedGrade and rating must be valid grades' });
      return;
    }
    const attempt: Attempt = {
      id: newId(),
      questionId,
      answerText: answerText.trim(),
      recommendedGrade,
      rating,
      critiqueText: typeof critiqueText === 'string' ? critiqueText : '',
      createdAt: nowIso(),
    };
    res.status(201).json(store.attempts.create(attempt));
  });

  return router;
}
```

- [ ] **Step 4: Mount it in `index.ts`**

Add the import:
```ts
import { questionAttemptsRouter } from './routes/attempts.js';
```
And mount it (the nested route must be registered with the `:id` param — add alongside the others):
```ts
  app.use('/api/questions/:id/attempts', questionAttemptsRouter(store));
```
Place this line **before** `app.use('/api/questions', questionsRouter(store));` is fine — Express matches the more specific path regardless, but keep grouping readable.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- packages/server/src/routes/attempts.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/attempts.ts packages/server/src/routes/attempts.test.ts packages/server/src/index.ts
git commit -F <commit-msg-file>
```
Commit message: `feat: add /api/questions/:id/attempts create+list`

---

# SLIVER 4 — `/grade` endpoint + grading contract + minimal Learn grading view

*Observable when done: solve → grade → rate loop runs in the browser.*

### Task 9: Grading contract (prompt builder + turn schema)

**Files:**
- Create: `packages/server/src/llm/grading-contract.ts`
- Create: `packages/server/src/llm/grading-contract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/llm/grading-contract.test.ts
import { describe, expect, it } from 'vitest';
import { buildGradingPrompt, gradingTurnSchema } from './grading-contract.js';

describe('buildGradingPrompt', () => {
  it('includes the question text', () => {
    const p = buildGradingPrompt({ canonicalText: 'Integrate x dx.' });
    expect(p).toContain('Integrate x dx.');
  });

  it('includes chapter description and book learning goal when present', () => {
    const p = buildGradingPrompt({
      canonicalText: 'Q',
      chapterDescription: 'Integration techniques',
      bookLearningGoal: 'Master calculus',
    });
    expect(p).toContain('Integration techniques');
    expect(p).toContain('Master calculus');
  });

  it('omits the optional context lines when absent', () => {
    const p = buildGradingPrompt({ canonicalText: 'Q' });
    expect(p).not.toMatch(/learning goal/i);
  });

  it('constrains the grader to react, not solve, and to grade only this question', () => {
    const p = buildGradingPrompt({ canonicalText: 'Q' });
    expect(p).toMatch(/this (one |single )?question/i);
    expect(p).toMatch(/do not (independently )?(produce|write).*solution/i);
  });
});

describe('gradingTurnSchema', () => {
  it('requires critiqueText and an enum recommendedGrade', () => {
    expect(gradingTurnSchema.required).toEqual(
      expect.arrayContaining(['critiqueText', 'recommendedGrade']),
    );
    expect(gradingTurnSchema.properties.recommendedGrade.enum).toEqual([
      'correct',
      'partial',
      'incorrect',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/server/src/llm/grading-contract.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the contract**

```ts
// packages/server/src/llm/grading-contract.ts

/** Context the grader is given about the question being answered. */
export interface GradingContext {
  /** The question's canonical LaTeX/markdown text. */
  canonicalText: string;
  /** The chapter's description (topics covered), when present. */
  chapterDescription?: string;
  /** The book's learning goal, when present. */
  bookLearningGoal?: string;
}

/**
 * Build the system-framing prompt for a grading conversation. Provider-agnostic.
 * Sent as the first `user` message ahead of the live transcript; the schema (below)
 * forces a recommended grade on every turn including the first.
 */
export function buildGradingPrompt(ctx: GradingContext): string {
  const lines = [
    'You are grading a student\'s answer to ONE specific titled question.',
    'Grade only this question. Do not solve other problems, wander to adjacent',
    'exercises, or introduce material beyond what is needed to judge THIS answer.',
    'React to the student\'s answer. Do not independently produce a full worked solution.',
    'Every turn, return critiqueText plus a recommendedGrade of "correct", "partial",',
    'or "incorrect". "partial" means the answer is at least 70% of the way there.',
    '',
    `Question:\n${ctx.canonicalText}`,
  ];
  if (ctx.chapterDescription !== undefined && ctx.chapterDescription.trim() !== '') {
    lines.push('', `Chapter context: ${ctx.chapterDescription}`);
  }
  if (ctx.bookLearningGoal !== undefined && ctx.bookLearningGoal.trim() !== '') {
    lines.push('', `Book learning goal: ${ctx.bookLearningGoal}`);
  }
  return lines.join('\n');
}

/** Structured-output schema forcing critique text + a recommended grade per turn. */
export const gradingTurnSchema = {
  type: 'object',
  properties: {
    critiqueText: { type: 'string' },
    recommendedGrade: { type: 'string', enum: ['correct', 'partial', 'incorrect'] },
  },
  required: ['critiqueText', 'recommendedGrade'],
  additionalProperties: false,
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/server/src/llm/grading-contract.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/llm/grading-contract.ts packages/server/src/llm/grading-contract.test.ts
git commit -F <commit-msg-file>
```
Commit message: `feat: add grading prompt builder and turn schema`

---

### Task 10: `POST /api/questions/:id/grade` (stateless replay)

**Files:**
- Create: `packages/server/src/routes/grade.ts`
- Create: `packages/server/src/routes/grade.test.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Write the failing route test**

```ts
// packages/server/src/routes/grade.test.ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { FakeProvider } from '../llm/fake-provider.js';
import { LlmError } from '../llm/provider.js';
import { ImageStore } from '../storage/images.js';
import { Store } from '../storage/store.js';

let dir: string;
let provider: FakeProvider;
let app: Awaited<ReturnType<typeof createApp>>;
let questionId: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-grade-'));
  const store = await Store.open(dir);
  provider = new FakeProvider({
    structured: { critiqueText: 'Good start, but check the constant.', recommendedGrade: 'partial' },
  });
  app = createApp(store, provider, new ImageStore(dir));
  const bookId = (await request(app).post('/api/books').send({ title: 'B' })).body.id;
  const chapterId = (await request(app).post(`/api/books/${bookId}/chapters`).send({ title: 'C' }))
    .body.id;
  questionId = (
    await request(app).post(`/api/chapters/${chapterId}/questions`).send({ canonicalText: 'q' })
  ).body.id;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('grade route', () => {
  it('returns critiqueText + recommendedGrade and replays the conversation', async () => {
    const res = await request(app)
      .post(`/api/questions/${questionId}/grade`)
      .send({ answerText: 'x^2/2', conversation: [{ role: 'user', text: 'x^2/2' }] });
    expect(res.status).toEqual(200);
    expect(res.body).toEqual({
      critiqueText: 'Good start, but check the constant.',
      recommendedGrade: 'partial',
    });
    // First message is the grading prompt; the transcript follows.
    expect(provider.lastConversation[0]?.role).toEqual('user');
    expect(provider.lastConversation.at(-1)?.text).toEqual('x^2/2');
  });

  it('404 for an unknown question', async () => {
    const res = await request(app)
      .post('/api/questions/nope/grade')
      .send({ answerText: 'x', conversation: [{ role: 'user', text: 'x' }] });
    expect(res.status).toEqual(404);
  });

  it('400 when answerText is empty', async () => {
    const res = await request(app)
      .post(`/api/questions/${questionId}/grade`)
      .send({ answerText: '', conversation: [] });
    expect(res.status).toEqual(400);
  });

  it('502 when the provider fails', async () => {
    provider.failWith(new LlmError('down'));
    const res = await request(app)
      .post(`/api/questions/${questionId}/grade`)
      .send({ answerText: 'x', conversation: [{ role: 'user', text: 'x' }] });
    expect(res.status).toEqual(502);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/server/src/routes/grade.test.ts`
Expected: FAIL — route not mounted.

- [ ] **Step 3: Write the router**

```ts
// packages/server/src/routes/grade.ts
import { Router } from 'express';
import { buildGradingPrompt, gradingTurnSchema, type GradingContext } from '../llm/grading-contract.js';
import { LlmError, type LlmProvider, type Message, type Role } from '../llm/provider.js';
import type { Store } from '../storage/store.js';

const ROLES: readonly Role[] = ['user', 'assistant'];

/** Validate a client-sent transcript into Message[] (text + role only; images ignored here). */
function parseConversation(raw: unknown): Message[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Message[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return undefined;
    const { role, text } = item as Record<string, unknown>;
    if (typeof text !== 'string') return undefined;
    if (typeof role !== 'string' || !(ROLES as readonly string[]).includes(role)) return undefined;
    out.push({ role: role as Role, text });
  }
  return out;
}

/** Nested under /api/questions/:id/grade — one stateless grading turn. */
export function questionGradeRouter(store: Store, provider: LlmProvider): Router {
  const router = Router({ mergeParams: true });

  router.post('/', async (req, res) => {
    const questionId = (req.params as { id: string }).id;
    const question = store.questions.getById(questionId);
    if (!question) {
      res.status(404).json({ error: 'question not found' });
      return;
    }
    const { answerText, conversation } = req.body ?? {};
    if (typeof answerText !== 'string' || answerText.trim() === '') {
      res.status(400).json({ error: 'answerText is required' });
      return;
    }
    const transcript = parseConversation(conversation);
    if (transcript === undefined) {
      res.status(400).json({ error: 'conversation must be an array of {role, text}' });
      return;
    }

    // Build grading context from the question's chapter + book (best-effort enrichment).
    const chapter = store.chapters.getById(question.chapterId);
    const book = chapter ? store.books.getById(chapter.bookId) : undefined;
    const ctx: GradingContext = {
      canonicalText: question.canonicalText,
      ...(chapter?.description !== undefined ? { chapterDescription: chapter.description } : {}),
      ...(book?.learningGoal !== undefined ? { bookLearningGoal: book.learningGoal } : {}),
    };

    const messages: Message[] = [{ role: 'user', text: buildGradingPrompt(ctx) }, ...transcript];

    try {
      const turn = await provider.completeStructured<{ critiqueText: string; recommendedGrade: string }>(
        messages,
        gradingTurnSchema,
      );
      res.json({ critiqueText: turn.critiqueText, recommendedGrade: turn.recommendedGrade });
    } catch (err) {
      if (err instanceof LlmError) {
        res.status(502).json({ error: 'grading failed' });
        return;
      }
      throw err;
    }
  });

  return router;
}
```

- [ ] **Step 4: Mount it in `index.ts`**

`createApp` already receives `provider`. Add:
```ts
import { questionGradeRouter } from './routes/grade.js';
```
and:
```ts
  app.use('/api/questions/:id/grade', questionGradeRouter(store, provider));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- packages/server/src/routes/grade.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/grade.ts packages/server/src/routes/grade.test.ts packages/server/src/index.ts
git commit -F <commit-msg-file>
```
Commit message: `feat: add stateless POST /api/questions/:id/grade`

---

### Task 11: Client API types + methods for grading & attempts

**Files:**
- Modify: `packages/client/src/api/types.ts`
- Modify: `packages/client/src/api/client.ts`

- [ ] **Step 1: Add types**

Append to `packages/client/src/api/types.ts`:

```ts
export type Grade = 'correct' | 'partial' | 'incorrect';

export type Role = 'user' | 'assistant';
export interface Message {
  role: Role;
  text: string;
}

export interface GradeTurn {
  critiqueText: string;
  recommendedGrade: Grade;
}

export interface Attempt {
  id: string;
  questionId: string;
  answerText: string;
  recommendedGrade: Grade;
  rating: Grade;
  critiqueText: string;
  createdAt: string;
}

export interface LearnNext {
  question: Question;
  book: Book;
  chapter: Chapter;
}
```

And add the optional state fields to the existing `Question` interface:

```ts
  skipped?: boolean;
  snoozedUntil?: string;
```

- [ ] **Step 2: Add API client methods**

Add to the `api` object in `packages/client/src/api/client.ts` (and extend the top import to include the new types):

```ts
import type {
  Attempt,
  Book,
  BookTree,
  Chapter,
  GradeTurn,
  LearnNext,
  Message,
  Question,
} from './types.js';
```

```ts
  // Grading & attempts
  gradeTurn: (questionId: string, body: { answerText: string; conversation: Message[] }) =>
    fetch(`/api/questions/${questionId}/grade`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<GradeTurn>(r)),
  createAttempt: (
    questionId: string,
    body: { answerText: string; recommendedGrade: Grade; rating: Grade; critiqueText: string },
  ) =>
    fetch(`/api/questions/${questionId}/attempts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<Attempt>(r)),
  listAttempts: (questionId: string) =>
    fetch(`/api/questions/${questionId}/attempts`).then((r) => json<Attempt[]>(r)),
  patchQuestionState: (id: string, patch: { skipped?: boolean; snoozedUntil?: string | null }) =>
    fetch(`/api/questions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => json<Question>(r)),
  getLearnNext: () =>
    fetch('/api/learn/next').then((r) => json<{ question: Question | null } & Partial<LearnNext>>(r)),
```

Add `Grade` to the type import as well (it is used in `createAttempt`):
```ts
import type { ..., Grade, ... } from './types.js';
```

- [ ] **Step 3: Typecheck the client**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/api/types.ts packages/client/src/api/client.ts
git commit -F <commit-msg-file>
```
Commit message: `feat: client API types and methods for grading/attempts`

---

### Task 12: Minimal Learn grading view (typed answer → critique + badge → save)

This is the first browser-observable grading loop. The navigator + suggested-next card come in Sliver 5; for now the Learn tab shows a chooser of questions (reuse the book tree) → grading view. Keep it small.

**Files:**
- Modify: `packages/client/src/tabs/learn.ts`
- Modify: `packages/client/src/styles.css`
- Create: `packages/client/src/tabs/learn.dom.test.ts`

- [ ] **Step 1: Write a focused DOM test for the grading view**

Use jsdom (as `render/content.dom.test.ts` does). We test the pure rendering of a grade badge and that submitting an answer calls the grader and renders the result. Stub `api`.

```ts
// packages/client/src/tabs/learn.dom.test.ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/client.js', () => ({
  api: {
    gradeTurn: vi.fn().mockResolvedValue({ critiqueText: 'Almost!', recommendedGrade: 'partial' }),
    createAttempt: vi.fn().mockResolvedValue({ id: 'a1' }),
  },
}));

import { api } from '../api/client.js';
import { renderGradingView } from './learn.js';

const question = {
  id: 'q1',
  chapterId: 'c1',
  canonicalText: 'Compute $1+1$.',
  source: { kind: 'text' as const },
  createdAt: '2026-06-07T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('grading view', () => {
  it('grades a typed answer and shows a grade badge', async () => {
    const host = document.createElement('div');
    renderGradingView(host, question, () => {});
    const textarea = host.querySelector('textarea')!;
    textarea.value = '2';
    host.querySelector<HTMLButtonElement>('.learn-answer')!.click();
    await vi.waitFor(() => {
      expect(host.querySelector('.grade-badge')).not.toBeNull();
    });
    expect(api.gradeTurn).toHaveBeenCalledWith('q1', {
      answerText: '2',
      conversation: [{ role: 'user', text: '2' }],
    });
    expect(host.querySelector('.grade-badge')!.textContent).toMatch(/partial/i);
  });

  it('saves an attempt with the recommended grade by default', async () => {
    const onDone = vi.fn();
    const host = document.createElement('div');
    renderGradingView(host, question, onDone);
    host.querySelector('textarea')!.value = '2';
    host.querySelector<HTMLButtonElement>('.learn-answer')!.click();
    await vi.waitFor(() => expect(host.querySelector('.learn-save')).not.toBeNull());
    host.querySelector<HTMLButtonElement>('.learn-save')!.click();
    await vi.waitFor(() => expect(api.createAttempt).toHaveBeenCalled());
    expect(api.createAttempt).toHaveBeenCalledWith('q1', {
      answerText: '2',
      recommendedGrade: 'partial',
      rating: 'partial',
      critiqueText: 'Almost!',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/client/src/tabs/learn.dom.test.ts`
Expected: FAIL — `renderGradingView` not exported.

- [ ] **Step 3: Implement the grading view + a minimal tab**

Replace `packages/client/src/tabs/learn.ts` with:

```ts
import { api } from '../api/client.js';
import type { Grade, Message, Question } from '../api/types.js';
import { renderContent } from '../render/content.js';

const GRADES: Grade[] = ['correct', 'partial', 'incorrect'];

/** Append a grade badge into `host`. */
function appendBadge(host: HTMLElement, grade: Grade): void {
  const badge = document.createElement('span');
  badge.className = `badge grade-badge grade-${grade}`;
  badge.textContent = grade;
  host.appendChild(badge);
}

/**
 * Grading view: question (KaTeX) + answer textarea → grade turn (critique + badge) →
 * rating control → save attempt. The chat transcript lives in memory and is lost on
 * reload, by design. `onDone` is called after a successful save.
 */
export function renderGradingView(
  host: HTMLElement,
  question: Question,
  onDone: () => void,
): void {
  host.innerHTML = '';
  const conversation: Message[] = [];
  let lastGrade: Grade | undefined;
  let lastCritique = '';

  const wrap = document.createElement('div');
  wrap.className = 'card learn-grade';
  host.appendChild(wrap);

  if (question.label) {
    const label = document.createElement('div');
    label.className = 'qlabel';
    label.textContent = question.label;
    wrap.appendChild(label);
  }
  const body = document.createElement('div');
  body.className = 'qbody';
  renderContent(body, question.canonicalText);
  wrap.appendChild(body);

  const chat = document.createElement('div');
  chat.className = 'chat grade-chat';
  wrap.appendChild(chat);

  const textarea = document.createElement('textarea');
  textarea.placeholder = 'Type your answer…';
  wrap.appendChild(textarea);

  const actions = document.createElement('div');
  actions.className = 'row';
  wrap.appendChild(actions);

  const answerBtn = document.createElement('button');
  answerBtn.className = 'btn learn-answer';
  answerBtn.textContent = 'Grade my answer';
  actions.appendChild(answerBtn);

  const error = document.createElement('div');
  error.className = 'error grade-error';
  wrap.appendChild(error);

  // Rating + save UI is added after the first grade arrives.
  const ratingHost = document.createElement('div');
  ratingHost.className = 'row learn-rating-row';
  wrap.appendChild(ratingHost);

  function renderRating(): void {
    ratingHost.innerHTML = '';
    if (lastGrade === undefined) return;
    const select = document.createElement('select');
    select.className = 'learn-rating';
    for (const g of GRADES) {
      const opt = document.createElement('option');
      opt.value = g;
      opt.textContent = g;
      if (g === lastGrade) opt.selected = true;
      select.appendChild(opt);
    }
    ratingHost.appendChild(select);

    const save = document.createElement('button');
    save.className = 'btn learn-save';
    save.textContent = 'Save attempt';
    save.addEventListener('click', () => {
      void (async () => {
        await api.createAttempt(question.id, {
          answerText: textarea.value.trim(),
          recommendedGrade: lastGrade!,
          rating: select.value as Grade,
          critiqueText: lastCritique,
        });
        onDone();
      })();
    });
    ratingHost.appendChild(save);
  }

  function appendTurn(role: 'user' | 'assistant', text: string, grade?: Grade): void {
    const msg = document.createElement('div');
    msg.className = `msg msg-${role}`;
    const p = document.createElement('span');
    p.textContent = text;
    msg.appendChild(p);
    if (grade) appendBadge(msg, grade);
    chat.appendChild(msg);
  }

  answerBtn.addEventListener('click', () => {
    const answerText = textarea.value.trim();
    if (answerText === '') return;
    error.textContent = '';
    answerBtn.disabled = true;
    // First turn carries the answer; subsequent turns would carry clarifications.
    const turnText = conversation.length === 0 ? answerText : answerText;
    conversation.push({ role: 'user', text: turnText });
    appendTurn('user', turnText);
    void (async () => {
      try {
        const turn = await api.gradeTurn(question.id, { answerText, conversation });
        conversation.push({ role: 'assistant', text: turn.critiqueText });
        appendTurn('assistant', turn.critiqueText, turn.recommendedGrade);
        lastGrade = turn.recommendedGrade;
        lastCritique = turn.critiqueText;
        renderRating();
      } catch {
        error.textContent = 'Grading failed — try again.';
        // keep the typed answer; pop the optimistic user turn so the transcript stays valid
        conversation.pop();
      } finally {
        answerBtn.disabled = false;
      }
    })();
  });
}

/** Learn tab — minimal chooser (Sliver 5 adds the suggested-next card + navigator). */
export function renderLearn(host: HTMLElement): void {
  host.innerHTML = '<h2>Learn</h2><p>Pick a question from Manage, or use the navigator (coming next).</p>';
}
```

Note: the `turnText` duplication is intentional placeholder symmetry for the later clarification box (Sliver 5); leave it — the reply box wiring in Task 16 replaces this handler. (If a reviewer flags it, simplify to `const turnText = answerText;`.)

- [ ] **Step 4: Add style hooks to `styles.css`**

Append minimal hooks (no framework):

```css
.card { border: 1px solid #ddd; border-radius: 6px; padding: 1rem; margin: 0.5rem 0; }
.chat { display: flex; flex-direction: column; gap: 0.5rem; margin: 0.5rem 0; }
.msg { padding: 0.5rem 0.75rem; border-radius: 6px; }
.msg-user { background: #eef; align-self: flex-end; }
.msg-assistant { background: #f4f4f4; }
.badge { display: inline-block; margin-left: 0.5rem; padding: 0 0.4rem; border-radius: 4px; font-size: 0.8rem; }
.grade-correct { background: #cfc; }
.grade-partial { background: #ffd; }
.grade-incorrect { background: #fcc; }
.learn-grade textarea { width: 100%; min-height: 4rem; }
.error { color: #b00; }
```

(If `styles.css` already defines `.card`/`.row`/etc., do not duplicate — only add the hooks that are missing.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- packages/client/src/tabs/learn.dom.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Verify in the browser**

`npm run dev`. The full solve→grade→rate loop isn't reachable from the Learn tab UI until Sliver 5 wires navigation. To verify now, temporarily call `renderGradingView` from `renderLearn` with a known question id fetched via the API (or wait for Task 15). At minimum, confirm `npm run dev` builds with no console errors on the Learn tab.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/tabs/learn.ts packages/client/src/tabs/learn.dom.test.ts packages/client/src/styles.css
git commit -F <commit-msg-file>
```
Commit message: `feat: Learn grading view — typed answer to critique, badge, save`

---

# SLIVER 5 — Skip/snooze PATCH + `learn/next` + suggested-next card + navigator

*Observable when done: suggested-next, Skip/Not now, and pick-your-own all work in the browser.*

### Task 13: Widen the question PATCH route for skip/snooze

**Files:**
- Modify: `packages/server/src/routes/questions.ts`
- Modify: `packages/server/src/routes/questions.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/server/src/routes/questions.test.ts`:

```ts
it('PATCH sets skipped and snoozedUntil; null clears the snooze', async () => {
  const q = (
    await request(app).post(`/api/chapters/${chapterId}/questions`).send({ canonicalText: 'a' })
  ).body;

  const skipped = await request(app).patch(`/api/questions/${q.id}`).send({ skipped: true });
  expect(skipped.body.skipped).toEqual(true);

  const snoozed = await request(app)
    .patch(`/api/questions/${q.id}`)
    .send({ snoozedUntil: '2026-06-08T00:00:00.000Z' });
  expect(snoozed.body.snoozedUntil).toEqual('2026-06-08T00:00:00.000Z');

  const cleared = await request(app).patch(`/api/questions/${q.id}`).send({ snoozedUntil: null });
  expect(cleared.body.snoozedUntil).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/server/src/routes/questions.test.ts`
Expected: FAIL — PATCH ignores the new fields.

- [ ] **Step 3: Widen the PATCH handler**

In `packages/server/src/routes/questions.ts`, the `questionsRouter` PATCH handler currently reads `{ canonicalText, label }`. Replace the patch-building block with:

```ts
    const patch: Partial<Omit<Question, 'id'>> = {};
    const { canonicalText, label, skipped, snoozedUntil } = req.body ?? {};
    if (typeof canonicalText === 'string') patch.canonicalText = canonicalText.trim();
    if (typeof label === 'string') patch.label = label.trim();
    if (typeof skipped === 'boolean') patch.skipped = skipped;
    if (typeof snoozedUntil === 'string') patch.snoozedUntil = snoozedUntil;
    // Explicit null clears the snooze. JsonCollection shallow-merges, so to actually
    // remove the field we update then strip it via a follow-up — but since the type
    // is optional and the store merges, set it to undefined is disallowed by strict TS.
    // Instead: when clearing, build the patched entity without the field.
    if (snoozedUntil === null) {
      const current = store.questions.getById(req.params.id)!;
      const { snoozedUntil: _drop, ...rest } = current;
      // Re-create the merged state without snoozedUntil by overwriting the stored item.
      const merged = { ...rest, ...patch } as Question;
      // Persist by deleting + re-creating is heavy; instead update with the full object.
      res.json(store.questions.update(req.params.id, merged));
      return;
    }
    res.json(store.questions.update(req.params.id, patch));
```

**Caveat to verify:** `JsonCollection.update` shallow-merges, so it cannot *remove* a key by merging. The clear-snooze branch above rebuilds the entity without `snoozedUntil` and passes the whole object to `update` — but merge still keeps the old key. **If the test for `null` clearing fails**, add a `replace`/`set` capability:
  - Preferred minimal fix: in `JsonCollection`, the `update` already does `{ ...stored, ...patch }`. To support removal, the clear branch should instead delete the question and `create` the rebuilt entity (same id). Implement the clear branch as:
    ```ts
    if (snoozedUntil === null) {
      const current = store.questions.getById(req.params.id)!;
      const { snoozedUntil: _drop, ...rest } = current;
      const rebuilt = { ...rest, ...patch } as Question;
      store.questions.delete(req.params.id);
      res.json(store.questions.create(rebuilt));
      return;
    }
    ```
  Use this delete+create form so the key is genuinely gone. Keep ordering acceptable (re-created item moves to the end of the array; `learn/next` sorts by chapter/createdAt, not array position, so this is safe).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/server/src/routes/questions.test.ts`
Expected: PASS (including the new case).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/questions.ts packages/server/src/routes/questions.test.ts
git commit -F <commit-msg-file>
```
Commit message: `feat: PATCH question supports skip/snooze (null clears snooze)`

---

### Task 14: `learn/next` service + `GET /api/learn/next`

**Files:**
- Create: `packages/server/src/services/learn-next.ts`
- Create: `packages/server/src/services/learn-next.test.ts`
- Create: `packages/server/src/routes/learn.ts`
- Create: `packages/server/src/routes/learn.test.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Write the failing service test**

```ts
// packages/server/src/services/learn-next.test.ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../storage/store.js';
import { suggestNext } from './learn-next.js';

let dir: string;
let store: Store;
let bookId: string;
let chapterId: string;

async function addQuestion(text: string, createdAt: string): Promise<string> {
  const q = store.questions.create({
    id: text,
    chapterId,
    canonicalText: text,
    source: { kind: 'text' },
    createdAt,
  });
  return q.id;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-next-'));
  store = await Store.open(dir);
  const book = store.books.create({ id: 'b1', title: 'B', createdAt: '2026-01-01T00:00:00.000Z' });
  bookId = book.id;
  const ch = store.chapters.create({
    id: 'c1',
    bookId,
    title: 'C',
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  chapterId = ch.id;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('suggestNext', () => {
  it('returns the earliest un-attempted question with its book + chapter', async () => {
    await addQuestion('q-late', '2026-02-02T00:00:00.000Z');
    await addQuestion('q-early', '2026-01-15T00:00:00.000Z');
    const next = suggestNext(store, '2026-06-07T00:00:00.000Z');
    expect(next?.question.id).toEqual('q-early');
    expect(next?.book.id).toEqual('b1');
    expect(next?.chapter.id).toEqual('c1');
  });

  it('excludes attempted questions', async () => {
    const id = await addQuestion('q', '2026-01-15T00:00:00.000Z');
    store.attempts.create({
      id: 'a1',
      questionId: id,
      answerText: 'x',
      recommendedGrade: 'correct',
      rating: 'correct',
      critiqueText: '',
      createdAt: '2026-01-16T00:00:00.000Z',
    });
    expect(suggestNext(store, '2026-06-07T00:00:00.000Z')).toBeUndefined();
  });

  it('excludes skipped questions', async () => {
    const id = await addQuestion('q', '2026-01-15T00:00:00.000Z');
    store.questions.update(id, { skipped: true });
    expect(suggestNext(store, '2026-06-07T00:00:00.000Z')).toBeUndefined();
  });

  it('excludes actively-snoozed questions but re-includes after expiry', async () => {
    const id = await addQuestion('q', '2026-01-15T00:00:00.000Z');
    store.questions.update(id, { snoozedUntil: '2026-06-08T00:00:00.000Z' });
    expect(suggestNext(store, '2026-06-07T00:00:00.000Z')).toBeUndefined();
    expect(suggestNext(store, '2026-06-09T00:00:00.000Z')?.question.id).toEqual(id);
  });

  it('orders by chapter.order then createdAt', async () => {
    const ch2 = store.chapters.create({
      id: 'c2',
      bookId,
      title: 'C2',
      order: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    store.questions.create({
      id: 'q-c2',
      chapterId: ch2.id,
      canonicalText: 'q',
      source: { kind: 'text' },
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await addQuestion('q-c1', '2026-02-01T00:00:00.000Z');
    expect(suggestNext(store, '2026-06-07T00:00:00.000Z')?.question.id).toEqual('q-c1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/server/src/services/learn-next.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the service**

```ts
// packages/server/src/services/learn-next.ts
import type { Book, Chapter, Question } from '../domain/types.js';
import type { Store } from '../storage/store.js';

export interface LearnNext {
  question: Question;
  book: Book;
  chapter: Chapter;
}

/**
 * The next question to suggest: un-attempted, not skipped, and not actively snoozed,
 * ordered by book order → chapter.order → question.createdAt. `now` is passed in so
 * the query is pure/testable. Returns undefined when nothing is eligible.
 *
 * Book order is the current books-array order (revisit if explicit ordering arrives).
 */
export function suggestNext(store: Store, now: string): LearnNext | undefined {
  const attempted = new Set(store.attempts.getAll().map((a) => a.questionId));
  const books = store.books.getAll();
  const bookOrder = new Map(books.map((b, i) => [b.id, i]));
  const chapters = store.chapters.getAll();
  const chapterById = new Map(chapters.map((c) => [c.id, c]));

  const eligible = store.questions.getAll().filter((q) => {
    if (attempted.has(q.id)) return false;
    if (q.skipped === true) return false;
    if (q.snoozedUntil !== undefined && q.snoozedUntil > now) return false;
    return chapterById.has(q.chapterId);
  });

  eligible.sort((a, b) => {
    const ca = chapterById.get(a.chapterId)!;
    const cb = chapterById.get(b.chapterId)!;
    const boa = bookOrder.get(ca.bookId) ?? Number.MAX_SAFE_INTEGER;
    const bob = bookOrder.get(cb.bookId) ?? Number.MAX_SAFE_INTEGER;
    if (boa !== bob) return boa - bob;
    if (ca.order !== cb.order) return ca.order - cb.order;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });

  const question = eligible[0];
  if (question === undefined) return undefined;
  const chapter = chapterById.get(question.chapterId)!;
  const book = books.find((b) => b.id === chapter.bookId);
  if (book === undefined) return undefined;
  return { question, book, chapter };
}
```

- [ ] **Step 4: Run service test to verify it passes**

Run: `npm test -- packages/server/src/services/learn-next.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing route test**

```ts
// packages/server/src/routes/learn.test.ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { FakeProvider } from '../llm/fake-provider.js';
import { ImageStore } from '../storage/images.js';
import { Store } from '../storage/store.js';

let dir: string;
let app: Awaited<ReturnType<typeof createApp>>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-learn-'));
  const store = await Store.open(dir);
  app = createApp(store, new FakeProvider(), new ImageStore(dir));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('GET /api/learn/next', () => {
  it('returns { question: null } when nothing is eligible', async () => {
    const res = await request(app).get('/api/learn/next');
    expect(res.status).toEqual(200);
    expect(res.body).toEqual({ question: null });
  });

  it('returns the suggested question with its book + chapter', async () => {
    const bookId = (await request(app).post('/api/books').send({ title: 'B' })).body.id;
    const chapterId = (await request(app).post(`/api/books/${bookId}/chapters`).send({ title: 'C' }))
      .body.id;
    await request(app).post(`/api/chapters/${chapterId}/questions`).send({ canonicalText: 'q' });
    const res = await request(app).get('/api/learn/next');
    expect(res.status).toEqual(200);
    expect(res.body.question.canonicalText).toEqual('q');
    expect(res.body.book.id).toEqual(bookId);
    expect(res.body.chapter.id).toEqual(chapterId);
  });
});
```

- [ ] **Step 6: Write the route**

```ts
// packages/server/src/routes/learn.ts
import { Router } from 'express';
import { nowIso } from '../domain/ids.js';
import { suggestNext } from '../services/learn-next.js';
import type { Store } from '../storage/store.js';

/** /api/learn — read-only suggestion endpoints. */
export function learnRouter(store: Store): Router {
  const router = Router();

  router.get('/next', (_req, res) => {
    const next = suggestNext(store, nowIso());
    if (next === undefined) {
      res.json({ question: null });
      return;
    }
    res.json(next);
  });

  return router;
}
```

- [ ] **Step 7: Mount it in `index.ts`**

```ts
import { learnRouter } from './routes/learn.js';
```
```ts
  app.use('/api/learn', learnRouter(store));
```

- [ ] **Step 8: Run route test + full suite**

Run: `npm test -- packages/server/src/routes/learn.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/services/learn-next.ts packages/server/src/services/learn-next.test.ts packages/server/src/routes/learn.ts packages/server/src/routes/learn.test.ts packages/server/src/index.ts
git commit -F <commit-msg-file>
```
Commit message: `feat: learn/next suggestion service and GET /api/learn/next`

---

### Task 15: Suggested-next card + Skip / Not now wiring (client)

**Files:**
- Modify: `packages/client/src/tabs/learn.ts`
- Modify: `packages/client/src/tabs/learn.dom.test.ts`

- [ ] **Step 1: Write the failing test for the suggestion card**

Extend the mock and add tests:

```ts
// add to the vi.mock factory in learn.dom.test.ts:
//   getLearnNext: vi.fn(),
//   patchQuestionState: vi.fn().mockResolvedValue({}),
// then:

import { renderLearn } from './learn.js';

describe('suggested-next card', () => {
  it('renders the suggested question with Answer / Skip / Not now', async () => {
    (api.getLearnNext as ReturnType<typeof vi.fn>).mockResolvedValue({
      question,
      book: { id: 'b1', title: 'B', createdAt: '' },
      chapter: { id: 'c1', bookId: 'b1', title: 'C', order: 0, createdAt: '' },
    });
    const host = document.createElement('div');
    renderLearn(host);
    await vi.waitFor(() => expect(host.querySelector('.learn-suggestion')).not.toBeNull());
    expect(host.querySelector('.learn-answer')).not.toBeNull();
    expect(host.querySelector('.learn-skip')).not.toBeNull();
    expect(host.querySelector('.learn-snooze')).not.toBeNull();
  });

  it('shows an empty state when there is no suggestion', async () => {
    (api.getLearnNext as ReturnType<typeof vi.fn>).mockResolvedValue({ question: null });
    const host = document.createElement('div');
    renderLearn(host);
    await vi.waitFor(() => expect(host.textContent).toMatch(/all caught up|nothing/i));
  });

  it('Skip patches skipped:true and reloads', async () => {
    (api.getLearnNext as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        question,
        book: { id: 'b1', title: 'B', createdAt: '' },
        chapter: { id: 'c1', bookId: 'b1', title: 'C', order: 0, createdAt: '' },
      })
      .mockResolvedValueOnce({ question: null });
    const host = document.createElement('div');
    renderLearn(host);
    await vi.waitFor(() => expect(host.querySelector('.learn-skip')).not.toBeNull());
    host.querySelector<HTMLButtonElement>('.learn-skip')!.click();
    await vi.waitFor(() => expect(api.patchQuestionState).toHaveBeenCalledWith('q1', { skipped: true }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/client/src/tabs/learn.dom.test.ts`
Expected: FAIL — `renderLearn` is still the stub.

- [ ] **Step 3: Implement the suggested-next card in `renderLearn`**

Replace the stub `renderLearn` at the bottom of `learn.ts` with:

```ts
/** Learn tab: suggested-next card on top; opens the grading view on Answer. */
export function renderLearn(host: HTMLElement): void {
  host.innerHTML = '';
  const heading = document.createElement('h2');
  heading.textContent = 'Learn';
  host.appendChild(heading);

  const cardHost = document.createElement('div');
  host.appendChild(cardHost);

  function reload(): void {
    cardHost.innerHTML = 'loading…';
    void (async () => {
      const next = await api.getLearnNext();
      cardHost.innerHTML = '';
      if (next.question === null || next.question === undefined) {
        const empty = document.createElement('p');
        empty.className = 'learn-empty';
        empty.textContent = 'All caught up — nothing new to learn right now.';
        cardHost.appendChild(empty);
        return;
      }
      renderSuggestion(cardHost, next.question, reload);
    })();
  }

  reload();
}

/** The suggested-next card: question preview + Answer / Skip / Not now. */
function renderSuggestion(host: HTMLElement, question: Question, reload: () => void): void {
  const card = document.createElement('div');
  card.className = 'card learn-suggestion';
  host.appendChild(card);

  if (question.label) {
    const label = document.createElement('div');
    label.className = 'qlabel';
    label.textContent = question.label;
    card.appendChild(label);
  }
  const body = document.createElement('div');
  body.className = 'qbody';
  renderContent(body, question.canonicalText);
  card.appendChild(body);

  const row = document.createElement('div');
  row.className = 'row';
  card.appendChild(row);

  const answer = document.createElement('button');
  answer.className = 'btn learn-answer';
  answer.textContent = 'Answer';
  answer.addEventListener('click', () => renderGradingView(host, question, reload));
  row.appendChild(answer);

  const skip = document.createElement('button');
  skip.className = 'link learn-skip';
  skip.textContent = 'Skip';
  skip.addEventListener('click', () => {
    void api.patchQuestionState(question.id, { skipped: true }).then(reload);
  });
  row.appendChild(skip);

  const snooze = document.createElement('button');
  snooze.className = 'link learn-snooze';
  snooze.textContent = 'Not now';
  snooze.addEventListener('click', () => {
    const until = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    void api.patchQuestionState(question.id, { snoozedUntil: until }).then(reload);
  });
  row.appendChild(snooze);
}
```

Note: `renderGradingView` takes `(host, question, onDone)`. Passing `host` (the card host) means the grading view replaces the card; `onDone`/`reload` re-fetches the next suggestion after a save. When opening the grading view from the suggestion, clear the card first — adjust the Answer handler to `answer.addEventListener('click', () => { host.innerHTML = ''; renderGradingView(host, question, reload); });`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packages/client/src/tabs/learn.dom.test.ts`
Expected: PASS (all suggestion + grading tests).

- [ ] **Step 5: Verify in the browser**

`npm run dev`. On the Learn tab: a suggested question appears. **Answer** → type → **Grade my answer** → critique + grade badge → choose rating → **Save attempt** → card advances to the next question. **Skip** and **Not now** advance and exclude appropriately.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/tabs/learn.ts packages/client/src/tabs/learn.dom.test.ts
git commit -F <commit-msg-file>
```
Commit message: `feat: Learn suggested-next card with Answer/Skip/Not now`

---

### Task 16: Book→chapter→question navigator + clarification reply box

**Files:**
- Modify: `packages/client/src/tabs/learn.ts`
- Modify: `packages/client/src/tabs/learn.dom.test.ts`

- [ ] **Step 1: Write the failing test (navigator picks a question; reply box re-grades)**

```ts
// add to the vi.mock factory: listBooks, getBookTree
// listBooks: vi.fn().mockResolvedValue([{ id: 'b1', title: 'B', createdAt: '' }]),
// getBookTree: vi.fn().mockResolvedValue({
//   id: 'b1', title: 'B', createdAt: '',
//   chapters: [{ id: 'c1', bookId: 'b1', title: 'C', order: 0, createdAt: '', questions: [question] }],
// }),

describe('navigator + reply box', () => {
  it('lists books, drills to a question, and opens its grading view', async () => {
    (api.getLearnNext as ReturnType<typeof vi.fn>).mockResolvedValue({ question: null });
    const host = document.createElement('div');
    renderLearn(host);
    await vi.waitFor(() => expect(host.querySelector('.learn-nav')).not.toBeNull());
    host.querySelector<HTMLButtonElement>('.learn-nav-book')!.click();
    await vi.waitFor(() => expect(host.querySelector('.learn-nav-chapter')).not.toBeNull());
    host.querySelector<HTMLButtonElement>('.learn-nav-chapter')!.click();
    await vi.waitFor(() => expect(host.querySelector('.learn-nav-question')).not.toBeNull());
    host.querySelector<HTMLButtonElement>('.learn-nav-question')!.click();
    await vi.waitFor(() => expect(host.querySelector('.learn-grade')).not.toBeNull());
  });

  it('reply box sends a follow-up turn with the full conversation', async () => {
    const host = document.createElement('div');
    renderGradingView(host, question, () => {});
    host.querySelector('textarea')!.value = 'first';
    host.querySelector<HTMLButtonElement>('.learn-answer')!.click();
    await vi.waitFor(() => expect(host.querySelector('.grade-badge')).not.toBeNull());
    (api.gradeTurn as ReturnType<typeof vi.fn>).mockClear();
    host.querySelector<HTMLTextAreaElement>('.learn-reply')!.value = 'a clarification';
    host.querySelector<HTMLButtonElement>('.learn-reply-send')!.click();
    await vi.waitFor(() => expect(api.gradeTurn).toHaveBeenCalled());
    const sent = (api.gradeTurn as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(sent.conversation.map((m: { text: string }) => m.text)).toContain('a clarification');
    expect(sent.conversation.length).toBeGreaterThanOrEqual(3); // user, assistant, user
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packages/client/src/tabs/learn.dom.test.ts`
Expected: FAIL — navigator + reply box not implemented.

- [ ] **Step 3: Add the navigator under the suggestion card**

In `renderLearn`, after appending `cardHost`, add a navigator host and render it:

```ts
  const navHost = document.createElement('div');
  navHost.className = 'learn-nav';
  host.appendChild(navHost);
  void renderNavigator(navHost, (q) => {
    host.innerHTML = '';
    renderGradingView(host, q, () => renderLearn(host));
  });
```

Add the navigator implementation (drill-down using the existing tree API):

```ts
import type { Book } from '../api/types.js';

/** Book → chapter → question drill-down; calls `onPick` with the chosen question. */
async function renderNavigator(host: HTMLElement, onPick: (q: Question) => void): Promise<void> {
  host.innerHTML = '<h3>Browse</h3>';
  const books = await api.listBooks();
  for (const book of books) {
    const btn = document.createElement('button');
    btn.className = 'link learn-nav-book';
    btn.textContent = book.title;
    btn.addEventListener('click', () => void openBook(host, book, onPick));
    host.appendChild(btn);
  }
}

async function openBook(host: HTMLElement, book: Book, onPick: (q: Question) => void): Promise<void> {
  host.innerHTML = `<h3>${book.title}</h3>`;
  const tree = await api.getBookTree(book.id);
  for (const chapter of tree.chapters) {
    const chBtn = document.createElement('button');
    chBtn.className = 'link learn-nav-chapter';
    chBtn.textContent = chapter.title;
    chBtn.addEventListener('click', () => {
      const list = document.createElement('div');
      for (const q of chapter.questions) {
        const qBtn = document.createElement('button');
        qBtn.className = 'link learn-nav-question';
        qBtn.textContent = q.label ?? q.canonicalText.slice(0, 40);
        qBtn.addEventListener('click', () => onPick(q));
        list.appendChild(qBtn);
      }
      host.appendChild(list);
    });
    host.appendChild(chBtn);
  }
}
```

(KaTeX escaping note: `book.title`/`chapter.title` are inserted via `innerHTML` here for brevity, matching short trusted titles; if titles can contain user HTML, switch to `textContent` on an `<h3>` element. Use `textContent` to be safe — replace the `innerHTML = \`<h3>${...}</h3>\`` lines with creating an `<h3>` and setting `.textContent`.)

- [ ] **Step 4: Add the clarification reply box to `renderGradingView`**

In `renderGradingView`, after the first assistant turn is rendered (inside `renderRating` or alongside it), ensure a reply box exists. Add a reply host created up-front and populated after the first grade:

```ts
  const replyHost = document.createElement('div');
  replyHost.className = 'row learn-reply-row';
  wrap.appendChild(replyHost);

  function ensureReplyBox(): void {
    if (replyHost.childElementCount > 0) return;
    const reply = document.createElement('textarea');
    reply.className = 'learn-reply';
    reply.placeholder = 'Clarify or add to your answer…';
    const send = document.createElement('button');
    send.className = 'btn learn-reply-send';
    send.textContent = 'Send';
    send.addEventListener('click', () => {
      const text = reply.value.trim();
      if (text === '') return;
      reply.value = '';
      conversation.push({ role: 'user', text });
      appendTurn('user', text);
      send.disabled = true;
      void (async () => {
        try {
          const turn = await api.gradeTurn(question.id, {
            answerText: textarea.value.trim(),
            conversation,
          });
          conversation.push({ role: 'assistant', text: turn.critiqueText });
          appendTurn('assistant', turn.critiqueText, turn.recommendedGrade);
          lastGrade = turn.recommendedGrade;
          lastCritique = turn.critiqueText;
          renderRating();
        } catch {
          error.textContent = 'Grading failed — try again.';
          conversation.pop();
        } finally {
          send.disabled = false;
        }
      })();
    });
    replyHost.appendChild(reply);
    replyHost.appendChild(send);
  }
```

Call `ensureReplyBox()` at the end of the first-answer success branch (right after `renderRating()` in the `answerBtn` handler).

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- packages/client/src/tabs/learn.dom.test.ts`
Expected: PASS (navigator + reply box + earlier tests).

- [ ] **Step 6: Full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS across server + client.

- [ ] **Step 7: Verify in the browser**

`npm run dev`. On Learn: browse books → chapter → pick a question → grade it; in a grading view, after the first grade, a reply box lets you clarify and re-grade; Save commits and returns to the suggestion.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/tabs/learn.ts packages/client/src/tabs/learn.dom.test.ts
git commit -F <commit-msg-file>
```
Commit message: `feat: Learn navigator and grading clarification reply box`

---

## Final verification

- [ ] Run `npm run typecheck && npm test` — all green.
- [ ] `npm run dev` and walk the full loop end to end in the browser per the spec's "Client / UI" section: suggested-next card (Answer/Skip/Not now + empty state), navigator drill-down, grading chat with per-turn grade badges, rating accept/override, Save attempt advancing the suggestion.
- [ ] Confirm extraction (Sliver 1 refactor) still works from Manage.

---

## Self-review notes (author)

- **Spec coverage:** Sliver 1 = general `LlmProvider` + `ImageRef` + extraction refactor (spec §"LLM conversational interface", build order 1). Sliver 2 = label improvement (spec §"Label-extraction improvement", order 2). Sliver 3 = `Attempt` model/store/routes (spec "Data model", `/attempts`, order 3). Sliver 4 = `/grade` + grading contract + minimal grading view (spec "Grade a turn", "Grading prompt", order 4). Sliver 5 = skip/snooze PATCH + `learn/next` + suggested-next card + navigator + reply box (spec "Skip/snooze", "Suggested next", "Client/UI", order 5).
- **Deferred (correctly not in plan):** Phase 1 photo transcription, SRS scheduler, answer KaTeX rendering, persisting the transcript, provider config UI — all listed as deferred in the spec.
- **Type consistency:** `Grade`, `Message`/`Role`, `Attempt`, `GradeTurn`, `LearnNext` are defined once server-side and mirrored client-side; `gradeTurn`/`createAttempt`/`listAttempts`/`patchQuestionState`/`getLearnNext` names are used consistently between Tasks 11, 12, 15, 16. `renderGradingView(host, question, onDone)` signature is consistent across Tasks 12, 15, 16.
- **Known risk flagged inline:** `JsonCollection.update` shallow-merges and cannot delete a key — Task 13 handles snooze-clear via delete+create with the same id, and notes the fallback explicitly.
