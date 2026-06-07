# Grading — Photo-first Attempts & the Learn tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full **photo → transcribe → confirm/edit → grade → rate → save** loop in the Learn tab. The user photographs their handwritten working (and/or types), the photos are transcribed to LaTeX by a transcribe-only vision call, the user confirms/edits, then an LLM critiques in a chat where **every turn carries a recommended grade**, and the user commits a final **Attempt** that preserves photos + typed text + final transcription + grade.

**Architecture:** Generalize `LlmProvider` to a conversational `complete`/`completeStructured` interface (with a lazy `ImageRef` abstraction), refactor the existing image extraction onto it, add an `Attempt` entity (with `imagePaths`/`transcription`) and JSON storage, add a transcribe-only contract + `/transcribe` route, add stateless full-transcript grading, add skip/snooze state + a `learn/next` suggestion service, and factor the extraction pane's image controls into a reusable multi-file component. The client gets a Learn tab with a suggested-next card, a book→chapter→question navigator, and an answer/transcribe/confirm/grade view.

**Tech Stack:** TypeScript (strict ESM), Express, Vitest + supertest, `@anthropic-ai/sdk`, Vite + vanilla TS client, KaTeX.

**Source spec:** `docs/superpowers/specs/2026-06-07-grading-photo-answers-design.md`

**Supersedes plan:** `docs/superpowers/plans/2026-06-07-grading-attempts.md` (typed-answer-first; DO NOT EXECUTE). Much of that plan's scaffolding (provider generalization, attempts repo, skip/snooze, learn/next, navigator) is reused here; the answer/transcribe/grade flow differs.

---

## File Structure

**Server — new files**
- `packages/server/src/llm/image-ref.ts` — `ImageRef` interface + `fileImage`/`bufferImage` constructors.
- `packages/server/src/llm/extract.ts` — provider-agnostic extraction helper + envelope validators (moved off the Anthropic provider).
- `packages/server/src/llm/transcription-contract.ts` — transcribe-only prompt builder + `{ transcription }` schema.
- `packages/server/src/llm/grading-contract.ts` — grading prompt builder + grading-turn schema.
- `packages/server/src/routes/transcribe.ts` — `POST /api/questions/:id/transcribe` (multi-image → combined LaTeX).
- `packages/server/src/routes/grade.ts` — `POST /api/questions/:id/grade`.
- `packages/server/src/routes/attempts.ts` — `POST` + `GET /api/questions/:id/attempts`.
- `packages/server/src/routes/learn.ts` — `GET /api/learn/next`.
- `packages/server/src/services/learn-next.ts` — suggested-next query.
- Test files co-located as `*.test.ts` per task.

**Server — modified files**
- `packages/server/src/llm/provider.ts` — generalize `LlmProvider`; add `Role`/`Message`/`CompleteOpts`; keep `ExtractedQuestion`, `LlmError`; drop `ExtractionRequest`.
- `packages/server/src/llm/extraction-contract.ts` — always-present `label` guidance + position fallback.
- `packages/server/src/llm/anthropic-api-provider.ts` — implement `complete`/`completeStructured`; drop the extraction-specific code (moved to `extract.ts`).
- `packages/server/src/llm/fake-provider.ts` — implement `complete`/`completeStructured`; record last conversation; `failWith`.
- `packages/server/src/domain/types.ts` — add `Grade`, `Attempt`; add `skipped`/`snoozedUntil` to `Question`.
- `packages/server/src/storage/store.ts` — open an `attempts` collection.
- `packages/server/src/routes/questions.ts` — drive extraction via `extractQuestions` helper; widen PATCH for `skipped`/`snoozedUntil`.
- `packages/server/src/index.ts` — mount transcribe, grade, attempts, and learn routers.

**Client — new files**
- `packages/client/src/components/image-input.ts` — reusable Take-photo + Choose-image control (single or multi file).

**Client — modified files**
- `packages/client/src/api/types.ts` — `Grade`, `Attempt`, `Message`, `GradeTurn`, `LearnNext`; `skipped`/`snoozedUntil` on `Question`.
- `packages/client/src/api/client.ts` — `transcribeAnswer`, `gradeTurn`, `createAttempt`, `listAttempts`, `patchQuestionState`, `getLearnNext`.
- `packages/client/src/manage/questions-pane.ts` — migrate the extract controls onto the reusable component.
- `packages/client/src/tabs/learn.ts` — replace stub with suggested-next card + navigator + answer/transcribe/confirm/grade view.
- `packages/client/src/styles.css` — style hooks for card/chat/badge/image-input.

---

## Conventions to follow (read before starting)

- **Strict TS, ESM.** `import`/`export` only, `.js` extension on relative imports. `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` are on — build optional fields conditionally (`...(x !== undefined ? { x } : {})`), never assign `undefined` to an optional property.
- **Repository contract** (`storage/repository.ts`): `create(entity)` takes a fully-formed entity with `id` already set; `getAll()`/`getById()` return deep clones. **`update(id, patch)` shallow-merges and CANNOT remove a key** (verified in `json-collection.ts:48-55`) — to clear an optional field, delete + re-create with the same id.
- **Ids/time:** `newId()` and `nowIso()` from `domain/ids.js`.
- **Route tests** use `supertest` against `createApp(store, provider, imageStore)` over a `mkdtemp` data dir, with `FakeProvider` and `ImageStore`. Mirror `routes/questions-extract.test.ts`.
- **Run a single test file:** `npm test -- <path>` from repo root. Full suite: `npm test`. Types: `npm run typecheck`.
- **Commits:** multi-line messages via `git commit -F <file>` (PowerShell mangles here-strings). Commit directly to `main` (no feature branches pre-v1). Clean up the temp commit-message file after.
- **Styling convention:** every new component gets a **generic base class + a specific modifier class** (matching `.row`, `.qbody`, `button.link`): card `class="card learn-suggestion"`, chat `class="chat grade-chat"`, turns `msg msg-user`/`msg msg-assistant`, grade badge `class="badge grade-badge grade-partial"`, primary actions `class="btn learn-answer"`. No CSS framework; styles in `styles.css`.

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

- [ ] **Step 2: Run test to verify it fails** — `npm test -- packages/server/src/llm/image-ref.test.ts` → FAIL (module missing).

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

- [ ] **Step 4: Run test to verify it passes** — PASS (2 tests).

- [ ] **Step 5: Commit**
```
git add packages/server/src/llm/image-ref.ts packages/server/src/llm/image-ref.test.ts
git commit -F <commit-msg-file>
```
Message: `feat: add ImageRef with fileImage/bufferImage constructors`

---

### Task 2: Generalize the `LlmProvider` interface

This changes the interface shape and **removes `extractQuestionsFromImage`/`ExtractionRequest`**. The tree will not compile until Tasks 3–4 move the two providers and the extraction route onto the new methods. Tasks 2–4 are committed together.

**Files:**
- Modify: `packages/server/src/llm/provider.ts`

- [ ] **Step 1: Replace the whole file with:**

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
  /** Images carried with this turn (extraction, answer transcription). */
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
  /** Schema-constrained completion; the provider validates/parses against `schema`. */
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

- [ ] **Step 2: Run typecheck to see the expected breakage** — `npm run typecheck` → FAIL (`anthropic-api-provider.ts`, `fake-provider.ts`, `routes/questions.ts` reference removed symbols). Fixed in Tasks 3–4; do not commit yet.

---

### Task 3: Implement the new methods on `FakeProvider`

**Files:**
- Modify: `packages/server/src/llm/fake-provider.ts`
- Modify: `packages/server/src/llm/fake-provider.test.ts` (none exists today at `src/llm/fake-provider.test.ts` — create it)

> Note: there is no `fake-provider.test.ts` in `src` currently (only a stale `dist` artifact). Create the file fresh.

- [ ] **Step 1: Write the failing test** — create `packages/server/src/llm/fake-provider.test.ts`:

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
    await p.complete([
      { role: 'user', text: 'q1' },
      { role: 'assistant', text: 'a1' },
    ]);
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

- [ ] **Step 2: Run test to verify it fails** — FAIL (constructor/methods don't match).

- [ ] **Step 3: Rewrite `FakeProvider`** — replace `packages/server/src/llm/fake-provider.ts`:

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

  async completeStructured<T>(conversation: Message[], _schema: object, _opts?: CompleteOpts): Promise<T> {
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

- [ ] **Step 4: Run test to verify it passes** — PASS (4 tests). (Typecheck still fails until Task 4.)

---

### Task 4: Re-express extraction on `completeStructured` (helper + Anthropic provider + route)

The extraction *contract* (prompt + schema) and the envelope shape `{ questions: [...] }` are unchanged. We move the orchestration into a provider-agnostic `extract.ts` helper, slim the Anthropic provider down to `complete`/`completeStructured`, and update the route to call the helper with `bufferImage(file.buffer)`.

**Files:**
- Create: `packages/server/src/llm/extract.ts`
- Create: `packages/server/src/llm/extract.test.ts`
- Modify: `packages/server/src/llm/anthropic-api-provider.ts`
- Modify: `packages/server/src/llm/anthropic-api-provider.test.ts`
- Modify: `packages/server/src/routes/questions.ts`
- Modify: `packages/server/src/routes/questions-extract.test.ts`

- [ ] **Step 1: Write the failing test for the extract helper**

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

- [ ] **Step 2: Run test to verify it fails** — FAIL (module missing).

- [ ] **Step 3: Write the extract helper** (validators copied from the current `anthropic-api-provider.ts`, now provider-agnostic):

```ts
// packages/server/src/llm/extract.ts
import { extractionPrompt, extractionSchema } from './extraction-contract.js';
import type { ImageRef } from './image-ref.js';
import { LlmError, type ExtractedQuestion, type LlmProvider } from './provider.js';

/** Structured-output schema for extraction: a top-level object wrapping the array. */
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

- [ ] **Step 4: Run test to verify it passes** — PASS (4 tests).

- [ ] **Step 5: Rewrite `AnthropicApiProvider`** — replace `packages/server/src/llm/anthropic-api-provider.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { type CompleteOpts, LlmError, type LlmProvider, type Message } from './provider.js';

/** Hard cap on a single request. Without this the SDK's 10-minute default (retried
 *  up to 2×) could hang the HTTP request for tens of minutes; a timeout → 502. */
const REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Build the Anthropic content blocks for one Message (images first, then text). */
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

  async completeStructured<T>(conversation: Message[], schema: object, opts?: CompleteOpts): Promise<T> {
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

- [ ] **Step 6: Rewrite the Anthropic provider test** — replace `packages/server/src/llm/anthropic-api-provider.test.ts`:

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

- [ ] **Step 7: Update the extraction route** — in `packages/server/src/routes/questions.ts`:

Replace imports:
```ts
import { extractionPrompt, extractionSchema } from '../llm/extraction-contract.js';
import { LlmError, type LlmProvider } from '../llm/provider.js';
```
with:
```ts
import { extractQuestions } from '../llm/extract.js';
import { bufferImage } from '../llm/image-ref.js';
import type { ImageMimeType } from '../llm/image-ref.js';
import { LlmError, type LlmProvider } from '../llm/provider.js';
```

Replace the extraction call block (the `extracted = await provider.extractQuestionsFromImage({...})` try) with:
```ts
    let extracted;
    try {
      extracted = await extractQuestions(provider, bufferImage(file.buffer, file.mimetype as ImageMimeType));
    } catch (err) {
      if (err instanceof LlmError) {
        res.status(502).json({ error: 'extraction failed' });
        return;
      }
      throw err;
    }
```

Note: the image is still saved to disk first (unchanged) for retention; we pass `file.buffer` to avoid a redundant re-read. `file.mimetype` was already validated by the `imageExt(file.mimetype)` guard above, so it is one of the four accepted `ImageMimeType` values.

- [ ] **Step 8: Update the extraction route test** — in `packages/server/src/routes/questions-extract.test.ts`, the `FakeProvider` is constructed positionally (`new FakeProvider([...])`). Migrate each construction to the new config envelope, keeping the assertions:
  - `new FakeProvider([{ canonicalText: '\\int x\\,dx', label: '2.4' }, { canonicalText: 'Prove it.' }])` → `new FakeProvider({ structured: { questions: [{ canonicalText: '\\int x\\,dx', label: '2.4' }, { canonicalText: 'Prove it.' }] } })`
  - `new FakeProvider([])` → `new FakeProvider({ structured: { questions: [] } })`
  - `new FakeProvider()` (default + `failWith`) → `new FakeProvider()` unchanged (default returns `{ questions: [] }`).

- [ ] **Step 9: Full typecheck + suite green** — `npm run typecheck && npm test`. If any test imported `parseExtractionResult`/`mediaTypeForPath` from `anthropic-api-provider.js`, repoint to `extract.js` or remove the now-irrelevant assertion. (Check `anthropic-api-provider.test.ts` was fully replaced in Step 6.)

- [ ] **Step 10: Verify in the browser** — `npm run dev`, open http://localhost:5173, Manage → a chapter → extract from `~/Downloads/test_problems_01.jpg`. Confirm extraction still creates questions.

- [ ] **Step 11: Commit (Tasks 2–4 together — the tree must compile)**
```
git add packages/server/src/llm/ packages/server/src/routes/questions.ts packages/server/src/routes/questions-extract.test.ts
git commit -F <commit-msg-file>
```
Message: `refactor: generalize LlmProvider to complete/completeStructured; extraction via helper`

---

# SLIVER 2 — Label-extraction improvement

*Observable when done: newly extracted questions always carry a label.*

### Task 5: Strengthen the extraction prompt for always-present labels

**Files:**
- Modify: `packages/server/src/llm/extraction-contract.ts`
- Create: `packages/server/src/llm/extraction-contract.test.ts`

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run test to verify it fails** — FAIL (always/fallback assertions don't match).

- [ ] **Step 3: Update the prompt** — replace the `extractionPrompt` array in `extraction-contract.ts`:

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

- [ ] **Step 4: Run test to verify it passes** — PASS (4 tests).

- [ ] **Step 5: Commit**
```
git add packages/server/src/llm/extraction-contract.ts packages/server/src/llm/extraction-contract.test.ts
git commit -F <commit-msg-file>
```
Message: `feat: extraction always yields a referenceable label`

---

# SLIVER 3 — `Attempt` model + repository + `/attempts` routes

*Observable when done: an attempt can be created (with photos/transcription) and listed via the API.*

### Task 6: Add domain types — `Grade`, `Attempt`, and `Question` skip/snooze

**Files:**
- Modify: `packages/server/src/domain/types.ts`

- [ ] **Step 1: Add the types** — append to `packages/server/src/domain/types.ts`:

```ts
/** Grade vocabulary. `partial` ⇒ the answer is ≥70% of the way there. */
export type Grade = 'correct' | 'partial' | 'incorrect';

/** A committed grading attempt — final state only; the in-flight chat is not stored. */
export interface Attempt {
  id: string;
  questionId: string;
  /** Saved answer-photo paths, relative under data/images (like extraction); may be empty. */
  imagePaths: string[];
  /** User's typed answer (plain text); may be "". */
  answerText: string;
  /** Final confirmed/edited LaTeX transcription of the photos; may be "". */
  transcription: string;
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

- [ ] **Step 2: Typecheck** — `npm run typecheck` → PASS (purely additive).

- [ ] **Step 3: Commit**
```
git add packages/server/src/domain/types.ts
git commit -F <commit-msg-file>
```
Message: `feat: add Grade/Attempt types and Question skip/snooze fields`

---

### Task 7: Open the `attempts` collection in `Store`

**Files:**
- Modify: `packages/server/src/storage/store.ts`
- Modify: `packages/server/src/storage/store.test.ts`

- [ ] **Step 1: Write the failing test** — add to `packages/server/src/storage/store.test.ts` (match the existing temp-dir pattern in that file):

```ts
it('opens an attempts collection that round-trips', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qb-store-attempts-'));
  try {
    const store = await Store.open(dir);
    const created = store.attempts.create({
      id: 'a1',
      questionId: 'q1',
      imagePaths: ['images/x.jpg'],
      answerText: 'x',
      transcription: 'z^3 = 1',
      recommendedGrade: 'partial',
      rating: 'correct',
      critiqueText: 'nice',
      createdAt: '2026-06-07T00:00:00.000Z',
    });
    expect(created.id).toEqual('a1');
    expect(store.attempts.getAll()).toHaveLength(1);
    expect(store.attempts.getAll()[0]?.imagePaths).toEqual(['images/x.jpg']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

(If `store.test.ts` lacks `mkdtemp`/`rm`/`tmpdir`/`join` imports, add them at the top.)

- [ ] **Step 2: Run test to verify it fails** — FAIL (`store.attempts` does not exist).

- [ ] **Step 3: Add the collection** — edit `packages/server/src/storage/store.ts`:

```ts
import type { Attempt, Book, Chapter, Question } from '../domain/types.js';
```
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

- [ ] **Step 4: Run test to verify it passes** — PASS.

- [ ] **Step 5: Commit**
```
git add packages/server/src/storage/store.ts packages/server/src/storage/store.test.ts
git commit -F <commit-msg-file>
```
Message: `feat: open attempts JSON collection in Store`

---

### Task 8: `/api/questions/:id/attempts` — create + list

The create route enforces the **invariant**: at least one of `imagePaths` (non-empty) or `answerText` (non-empty) must be present.

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
  imagePaths: ['images/a.jpg'],
  answerText: '',
  transcription: 'z^3 = 1',
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
    expect(created.body).toMatchObject({
      questionId,
      rating: 'correct',
      recommendedGrade: 'partial',
      imagePaths: ['images/a.jpg'],
      transcription: 'z^3 = 1',
    });
    expect(created.body.id).toBeTruthy();
    const list = await request(app).get(`/api/questions/${questionId}/attempts`);
    expect(list.body).toHaveLength(1);
  });

  it('accepts a typed-only attempt (answerText, no photos)', async () => {
    const res = await request(app)
      .post(`/api/questions/${questionId}/attempts`)
      .send({ ...body, imagePaths: [], answerText: 'my typed answer', transcription: '' });
    expect(res.status).toEqual(201);
  });

  it('404 when the question does not exist', async () => {
    const res = await request(app).post('/api/questions/nope/attempts').send(body);
    expect(res.status).toEqual(404);
  });

  it('400 when neither photo nor typed answer is present', async () => {
    const res = await request(app)
      .post(`/api/questions/${questionId}/attempts`)
      .send({ ...body, imagePaths: [], answerText: '' });
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

- [ ] **Step 2: Run test to verify it fails** — FAIL (router not mounted).

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

/** Validate the imagePaths field into a string[] (defaults to [] when absent). */
function parseImagePaths(raw: unknown): string[] | undefined {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((p) => typeof p !== 'string')) return undefined;
  return raw as string[];
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
    const { imagePaths, answerText, transcription, recommendedGrade, rating, critiqueText } =
      req.body ?? {};

    const paths = parseImagePaths(imagePaths);
    if (paths === undefined) {
      res.status(400).json({ error: 'imagePaths must be an array of strings' });
      return;
    }
    const answer = typeof answerText === 'string' ? answerText.trim() : '';
    // Invariant: at least one of a photo or a typed answer.
    if (paths.length === 0 && answer === '') {
      res.status(400).json({ error: 'attach a photo or type an answer' });
      return;
    }
    if (!isGrade(recommendedGrade) || !isGrade(rating)) {
      res.status(400).json({ error: 'recommendedGrade and rating must be valid grades' });
      return;
    }
    const attempt: Attempt = {
      id: newId(),
      questionId,
      imagePaths: paths,
      answerText: answer,
      transcription: typeof transcription === 'string' ? transcription : '',
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

- [ ] **Step 4: Mount it in `index.ts`** — add the import and mount (place the nested `:id/attempts` route before `app.use('/api/questions', ...)` for readable grouping):
```ts
import { questionAttemptsRouter } from './routes/attempts.js';
```
```ts
  app.use('/api/questions/:id/attempts', questionAttemptsRouter(store));
```

- [ ] **Step 5: Run test to verify it passes** — PASS (6 tests).

- [ ] **Step 6: Commit**
```
git add packages/server/src/routes/attempts.ts packages/server/src/routes/attempts.test.ts packages/server/src/index.ts
git commit -F <commit-msg-file>
```
Message: `feat: add /api/questions/:id/attempts create+list (photo/typed invariant)`

---

# SLIVER 4 — Reusable image-input component; migrate extraction pane

*Observable when done: extraction still works in the browser, now via the shared component.*

### Task 9: Reusable `image-input` component + migrate the extraction pane

**Files:**
- Create: `packages/client/src/components/image-input.ts`
- Create: `packages/client/src/components/image-input.dom.test.ts`
- Modify: `packages/client/src/manage/questions-pane.ts`

- [ ] **Step 1: Write the failing DOM test** (jsdom, like `render/content.dom.test.ts`):

```ts
// packages/client/src/components/image-input.dom.test.ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createImageInput } from './image-input.js';

describe('createImageInput', () => {
  it('renders Take-photo and Choose-image controls', () => {
    const { element } = createImageInput({ onFiles: () => {} });
    expect(element.querySelector('.image-input-camera')).not.toBeNull();
    expect(element.querySelector('.image-input-choose')).not.toBeNull();
  });

  it('emits a single file by default', () => {
    const onFiles = vi.fn();
    const { element } = createImageInput({ onFiles });
    const input = element.querySelector<HTMLInputElement>('.image-input-file')!;
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it('multiple:true sets the multiple attribute and emits all files', () => {
    const onFiles = vi.fn();
    const { element } = createImageInput({ multiple: true, onFiles });
    const input = element.querySelector<HTMLInputElement>('.image-input-file')!;
    expect(input.multiple).toEqual(true);
    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
    ];
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
    expect(onFiles).toHaveBeenCalledWith(files);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL (module missing).

- [ ] **Step 3: Write the component** (factored from `questions-pane.ts`'s existing Take-photo/Choose-image logic):

```ts
// packages/client/src/components/image-input.ts

export interface ImageInputOptions {
  /** Allow selecting more than one file (answer photos). Default: false (single). */
  multiple?: boolean;
  /** Called with the chosen file(s) on each selection. */
  onFiles: (files: File[]) => void;
}

export interface ImageInput {
  /** The control's root element — append it where you want the buttons. */
  element: HTMLElement;
  /** Clear the underlying inputs so the same file can be re-selected. */
  reset(): void;
  /** Enable/disable both buttons (e.g. while uploading). */
  setDisabled(disabled: boolean): void;
}

/**
 * Take-photo + Choose-image controls over a hidden file input. "Take photo" sets
 * capture="environment" (rear camera on mobile; a normal dialog on desktop). The
 * caller owns upload + progress UX via `onFiles`. Single file by default; pass
 * `multiple: true` for the answer-photo case.
 */
export function createImageInput(opts: ImageInputOptions): ImageInput {
  const element = document.createElement('span');
  element.className = 'image-input';

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.className = 'image-input-file';
  file.style.display = 'none';
  if (opts.multiple) file.multiple = true;

  // Separate camera-capture input so "Take photo" requests the rear camera without
  // affecting the plain "Choose image" picker.
  const camera = document.createElement('input');
  camera.type = 'file';
  camera.accept = 'image/*';
  camera.capture = 'environment';
  camera.className = 'image-input-camera-file';
  camera.style.display = 'none';
  if (opts.multiple) camera.multiple = true;

  const takeBtn = document.createElement('button');
  takeBtn.type = 'button';
  takeBtn.className = 'btn image-input-camera';
  takeBtn.textContent = 'Take photo';

  const chooseBtn = document.createElement('button');
  chooseBtn.type = 'button';
  chooseBtn.className = 'btn image-input-choose';
  chooseBtn.textContent = 'Choose image';

  takeBtn.addEventListener('click', () => camera.click());
  chooseBtn.addEventListener('click', () => file.click());

  function emit(input: HTMLInputElement): void {
    const files = input.files ? Array.from(input.files) : [];
    if (files.length > 0) opts.onFiles(files);
    input.value = ''; // allow re-selecting the same file
  }
  file.addEventListener('change', () => emit(file));
  camera.addEventListener('change', () => emit(camera));

  element.append(takeBtn, chooseBtn, file, camera);

  return {
    element,
    reset(): void {
      file.value = '';
      camera.value = '';
    },
    setDisabled(disabled: boolean): void {
      takeBtn.disabled = disabled;
      chooseBtn.disabled = disabled;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes** — PASS (3 tests).

- [ ] **Step 5: Migrate the extraction pane** — in `packages/client/src/manage/questions-pane.ts`, replace the hand-rolled `takeBtn`/`chooseBtn`/`cameraInput`/`fileInput` block (and the two `addEventListener('change', …)` handlers) with the component. Keep `runExtract(file)` behavior (single file) but drive it from `onFiles`:

```ts
import { createImageInput } from '../components/image-input.js';
```

Replace the controls + handlers with:
```ts
  const status = document.createElement('div');
  status.className = 'status';

  const imageInput = createImageInput({
    onFiles: (files) => {
      const file = files[0];
      if (file) void runExtract(file);
    },
  });

  // Shared upload flow: disable controls, show progress, extract, refresh.
  async function runExtract(file: File): Promise<void> {
    status.textContent = '';
    addBtn.disabled = true;
    imageInput.setDisabled(true);
    status.textContent = 'Extracting…';
    try {
      await api.extractQuestionsFromImage(chapter.id, file);
      await refresh();
      status.textContent = '';
    } catch {
      status.textContent = 'Extraction failed — try again.';
    } finally {
      addBtn.disabled = false;
      imageInput.setDisabled(false);
      imageInput.reset();
    }
  }

  addRow.append(labelInput, input, addBtn, imageInput.element);
  host.append(addRow, status);
```

(Remove the now-unused `extractButtons`, `takeBtn`, `chooseBtn`, `cameraInput`, `fileInput` declarations and their handlers. The previous "Extracting…" was shown on the button text; we now show it in `status`.)

- [ ] **Step 6: Typecheck + suite** — `npm run typecheck && npm test` → PASS.

- [ ] **Step 7: Verify in the browser** — `npm run dev`, Manage → chapter → extract from `~/Downloads/test_problems_01.jpg`. Confirm Take-photo / Choose-image still work and questions appear.

- [ ] **Step 8: Commit**
```
git add packages/client/src/components/image-input.ts packages/client/src/components/image-input.dom.test.ts packages/client/src/manage/questions-pane.ts
git commit -F <commit-msg-file>
```
Message: `refactor: extract reusable image-input component; migrate extraction pane`

---

# SLIVER 5 — `/transcribe` + transcription contract; answer→transcribe→confirm in Learn

*Observable when done: photograph the test image, see the transcribed LaTeX, edit it.*

### Task 10: Transcription contract (transcribe-only prompt + schema)

**Files:**
- Create: `packages/server/src/llm/transcription-contract.ts`
- Create: `packages/server/src/llm/transcription-contract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/llm/transcription-contract.test.ts
import { describe, expect, it } from 'vitest';
import { buildTranscriptionPrompt, transcriptionSchema } from './transcription-contract.js';

describe('buildTranscriptionPrompt', () => {
  it('includes the question text as reference', () => {
    const p = buildTranscriptionPrompt('Compute z^3 where z = -1/2 + sqrt(3)/2 i.');
    expect(p).toContain('Compute z^3');
  });

  it('marks the question as reference-only, not to be answered', () => {
    const p = buildTranscriptionPrompt('Q');
    expect(p).toMatch(/reference only/i);
  });

  it('hard-forbids solving / correcting / completing / grading', () => {
    const p = buildTranscriptionPrompt('Q');
    expect(p).toMatch(/do not solve/i);
    expect(p).toMatch(/correct/i);
    expect(p).toMatch(/complete/i);
    expect(p).toMatch(/transcribe (it )?(wrong|incomplete|exactly|faithfully)/i);
  });
});

describe('transcriptionSchema', () => {
  it('requires a single transcription string', () => {
    expect(transcriptionSchema.required).toContain('transcription');
    expect(transcriptionSchema.properties.transcription.type).toEqual('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL (module missing).

- [ ] **Step 3: Write the contract**

```ts
// packages/server/src/llm/transcription-contract.ts

/**
 * The transcribe-ONLY contract for handwritten answer photos. The agent's single job
 * is to transcribe the working exactly as written — never to solve, correct, complete,
 * or grade it. (Otherwise grading would judge the agent's correction, not the student's
 * work.) The question text is supplied as REFERENCE ONLY, to disambiguate handwriting.
 */
export function buildTranscriptionPrompt(questionText: string): string {
  return [
    'You are transcribing a student\'s handwritten working from one or more photos.',
    'Your ONLY job is to transcribe what is written into LaTeX/markdown, EXACTLY as written.',
    'Do NOT solve the problem. Do NOT correct mistakes. Do NOT complete unfinished steps.',
    'Do NOT comment or grade. If the working is wrong or incomplete, transcribe it',
    'wrong/incomplete — faithfully reproduce exactly what the student actually wrote.',
    'Preserve mathematical notation exactly using LaTeX.',
    'Combine all photos into a single transcription block (they are pages of one answer).',
    '',
    'The question below is provided as REFERENCE ONLY, to help you read unclear handwriting.',
    'It is NOT something to answer, solve, or steer the transcription toward.',
    '',
    `Question (reference only):\n${questionText}`,
  ].join('\n');
}

/** Structured-output schema: a single combined transcription block. */
export const transcriptionSchema = {
  type: 'object',
  properties: { transcription: { type: 'string' } },
  required: ['transcription'],
  additionalProperties: false,
} as const;
```

- [ ] **Step 4: Run test to verify it passes** — PASS (4 tests).

- [ ] **Step 5: Commit**
```
git add packages/server/src/llm/transcription-contract.ts packages/server/src/llm/transcription-contract.test.ts
git commit -F <commit-msg-file>
```
Message: `feat: add transcribe-only transcription contract`

---

### Task 11: `POST /api/questions/:id/transcribe` (multi-image → combined LaTeX)

Saves each uploaded image via `ImageStore` (retained for the eventual attempt), sends all of them in one user `Message` with the transcription prompt, returns `{ transcription, imagePaths }`.

**Files:**
- Create: `packages/server/src/routes/transcribe.ts`
- Create: `packages/server/src/routes/transcribe.test.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Write the failing route test**

```ts
// packages/server/src/routes/transcribe.test.ts
import { mkdtemp, readdir, rm } from 'node:fs/promises';
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
  dir = await mkdtemp(join(tmpdir(), 'qb-transcribe-'));
  const store = await Store.open(dir);
  provider = new FakeProvider({ structured: { transcription: 'z^3 = 1' } });
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

describe('transcribe route', () => {
  it('saves images and returns combined transcription + imagePaths', async () => {
    const res = await request(app)
      .post(`/api/questions/${questionId}/transcribe`)
      .attach('images', Buffer.from('a'), { filename: 'p1.png', contentType: 'image/png' })
      .attach('images', Buffer.from('b'), { filename: 'p2.png', contentType: 'image/png' });
    expect(res.status).toEqual(200);
    expect(res.body.transcription).toEqual('z^3 = 1');
    expect(res.body.imagePaths).toHaveLength(2);
    const files = await readdir(join(dir, 'images'));
    expect(files).toHaveLength(2);
    // The question text is supplied to the transcriber as reference, all images in one turn.
    expect(provider.lastConversation).toHaveLength(1);
    expect(provider.lastConversation[0]?.images).toHaveLength(2);
    expect(provider.lastConversation[0]?.text).toMatch(/reference only/i);
  });

  it('404 for an unknown question', async () => {
    const res = await request(app)
      .post('/api/questions/nope/transcribe')
      .attach('images', Buffer.from('a'), { filename: 'p.png', contentType: 'image/png' });
    expect(res.status).toEqual(404);
  });

  it('400 when no image is uploaded', async () => {
    const res = await request(app).post(`/api/questions/${questionId}/transcribe`).send();
    expect(res.status).toEqual(400);
  });

  it('400 when an upload is not an image', async () => {
    const res = await request(app)
      .post(`/api/questions/${questionId}/transcribe`)
      .attach('images', Buffer.from('x'), { filename: 'n.txt', contentType: 'text/plain' });
    expect(res.status).toEqual(400);
  });

  it('502 when the provider fails', async () => {
    provider.failWith(new LlmError('down'));
    const res = await request(app)
      .post(`/api/questions/${questionId}/transcribe`)
      .attach('images', Buffer.from('a'), { filename: 'p.png', contentType: 'image/png' });
    expect(res.status).toEqual(502);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL (route not mounted).

- [ ] **Step 3: Write the router**

```ts
// packages/server/src/routes/transcribe.ts
import { Router } from 'express';
import multer from 'multer';
import { bufferImage, type ImageMimeType } from '../llm/image-ref.js';
import { LlmError, type LlmProvider, type Message } from '../llm/provider.js';
import {
  buildTranscriptionPrompt,
  transcriptionSchema,
} from '../llm/transcription-contract.js';
import type { ImageStore } from '../storage/images.js';
import type { Store } from '../storage/store.js';

/** Map a known image mimetype to a file extension; undefined ⇒ not an accepted image. */
function imageExt(mimetype: string): string | undefined {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  return map[mimetype];
}

/** Nested under /api/questions/:id/transcribe — multi-image → one combined transcription. */
export function questionTranscribeRouter(
  store: Store,
  provider: LlmProvider,
  imageStore: ImageStore,
): Router {
  const router = Router({ mergeParams: true });
  const upload = multer({ storage: multer.memoryStorage() });

  router.post('/', upload.array('images'), async (req, res) => {
    const questionId = (req.params as { id: string }).id;
    const question = store.questions.getById(questionId);
    if (!question) {
      res.status(404).json({ error: 'question not found' });
      return;
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: 'at least one image is required' });
      return;
    }
    // Validate every file is an accepted image before saving any.
    for (const file of files) {
      if (!imageExt(file.mimetype)) {
        res.status(400).json({ error: 'uploads must be images (png, jpeg, webp, gif)' });
        return;
      }
    }

    // Save each image (retained for the eventual attempt) and build image-bearing turn.
    const imagePaths: string[] = [];
    const images = [];
    for (const file of files) {
      const ext = imageExt(file.mimetype)!;
      const { imagePath } = await imageStore.save(file.buffer, ext);
      imagePaths.push(imagePath);
      images.push(bufferImage(file.buffer, file.mimetype as ImageMimeType));
    }

    const message: Message = {
      role: 'user',
      text: buildTranscriptionPrompt(question.canonicalText),
      images,
    };

    try {
      const out = await provider.completeStructured<{ transcription: string }>(
        [message],
        transcriptionSchema,
      );
      res.json({ transcription: out.transcription, imagePaths });
    } catch (err) {
      if (err instanceof LlmError) {
        res.status(502).json({ error: 'transcription failed' });
        return;
      }
      throw err;
    }
  });

  return router;
}
```

- [ ] **Step 4: Mount it in `index.ts`** — `createApp` already receives `provider` and `imageStore`:
```ts
import { questionTranscribeRouter } from './routes/transcribe.js';
```
```ts
  app.use('/api/questions/:id/transcribe', questionTranscribeRouter(store, provider, imageStore));
```

- [ ] **Step 5: Run test to verify it passes** — PASS (5 tests).

- [ ] **Step 6: Full suite + typecheck** — `npm run typecheck && npm test` → PASS.

- [ ] **Step 7: Commit**
```
git add packages/server/src/routes/transcribe.ts packages/server/src/routes/transcribe.test.ts packages/server/src/index.ts
git commit -F <commit-msg-file>
```
Message: `feat: add POST /api/questions/:id/transcribe (combined LaTeX)`

---

### Task 12: Client API types + `transcribeAnswer`; answer→transcribe→confirm view (no grading yet)

This is the first browser-observable photo flow. Grading comes in Sliver 6; here we build the answer step (image-input multi-file + typed textarea), the transcribe call, and the editable confirm step. The Learn tab temporarily mounts this view via a small chooser so it's reachable.

**Files:**
- Modify: `packages/client/src/api/types.ts`
- Modify: `packages/client/src/api/client.ts`
- Modify: `packages/client/src/tabs/learn.ts`
- Modify: `packages/client/src/styles.css`
- Create: `packages/client/src/tabs/learn.dom.test.ts`

- [ ] **Step 1: Add client types** — append to `packages/client/src/api/types.ts`:

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

export interface TranscribeResult {
  transcription: string;
  imagePaths: string[];
}

export interface Attempt {
  id: string;
  questionId: string;
  imagePaths: string[];
  answerText: string;
  transcription: string;
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

And add the optional state fields to the existing `Question` interface (after `source`):
```ts
  skipped?: boolean;
  snoozedUntil?: string;
```

- [ ] **Step 2: Add API client methods** — extend the import in `client.ts` and add to the `api` object:

```ts
import type {
  Attempt,
  Book,
  BookTree,
  Chapter,
  Grade,
  GradeTurn,
  LearnNext,
  Message,
  Question,
  TranscribeResult,
} from './types.js';
```

```ts
  // Grading & attempts
  transcribeAnswer: (questionId: string, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append('images', f);
    return fetch(`/api/questions/${questionId}/transcribe`, { method: 'POST', body: form }).then(
      (r) => json<TranscribeResult>(r),
    );
  },
  gradeTurn: (questionId: string, body: { conversation: Message[] }) =>
    fetch(`/api/questions/${questionId}/grade`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<GradeTurn>(r)),
  createAttempt: (
    questionId: string,
    body: {
      imagePaths: string[];
      answerText: string;
      transcription: string;
      recommendedGrade: Grade;
      rating: Grade;
      critiqueText: string;
    },
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

- [ ] **Step 3: Write a focused DOM test for the answer→transcribe→confirm view**

```ts
// packages/client/src/tabs/learn.dom.test.ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/client.js', () => ({
  api: {
    transcribeAnswer: vi
      .fn()
      .mockResolvedValue({ transcription: 'z^3 = 1', imagePaths: ['images/a.png'] }),
    gradeTurn: vi.fn().mockResolvedValue({ critiqueText: 'Almost!', recommendedGrade: 'partial' }),
    createAttempt: vi.fn().mockResolvedValue({ id: 'a1' }),
    getLearnNext: vi.fn(),
    patchQuestionState: vi.fn().mockResolvedValue({}),
    listBooks: vi.fn(),
    getBookTree: vi.fn(),
  },
}));

import { api } from '../api/client.js';
import { renderAnswerView } from './learn.js';

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

describe('answer → transcribe → confirm', () => {
  it('Transcribe & continue is disabled until a photo or typed text exists', () => {
    const host = document.createElement('div');
    renderAnswerView(host, question, () => {});
    const cont = host.querySelector<HTMLButtonElement>('.learn-transcribe')!;
    expect(cont.disabled).toEqual(true);
    host.querySelector<HTMLTextAreaElement>('.learn-typed')!.value = '2';
    host.querySelector<HTMLTextAreaElement>('.learn-typed')!.dispatchEvent(new Event('input'));
    expect(cont.disabled).toEqual(false);
  });

  it('typed-only path skips transcription and shows the editable confirm step', async () => {
    const host = document.createElement('div');
    renderAnswerView(host, question, () => {});
    host.querySelector<HTMLTextAreaElement>('.learn-typed')!.value = '2';
    host.querySelector<HTMLTextAreaElement>('.learn-typed')!.dispatchEvent(new Event('input'));
    host.querySelector<HTMLButtonElement>('.learn-transcribe')!.click();
    await vi.waitFor(() => expect(host.querySelector('.learn-confirm')).not.toBeNull());
    // No photos ⇒ transcription not called.
    expect(api.transcribeAnswer).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLTextAreaElement>('.learn-transcription')).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails** — FAIL (`renderAnswerView` not exported).

- [ ] **Step 5: Implement the answer view + a minimal Learn chooser**

Replace `packages/client/src/tabs/learn.ts`. Build the answer step (image-input multi-file + typed textarea), the transcribe call (skipped when no photos), and the editable confirm step. Wire it to `renderGradingView` (added in Sliver 6) via a callback — for now, the confirm step's "grade" button calls `onConfirm(combinedAnswer)`.

```ts
import { api } from '../api/client.js';
import type { Grade, Message, Question } from '../api/types.js';
import { createImageInput } from '../components/image-input.js';
import { renderContent } from '../render/content.js';

const GRADES: Grade[] = ['correct', 'partial', 'incorrect'];

/** Render question label + KaTeX body into `parent`. */
function renderQuestionHeader(parent: HTMLElement, question: Question): void {
  if (question.label) {
    const label = document.createElement('div');
    label.className = 'qlabel';
    label.textContent = question.label;
    parent.appendChild(label);
  }
  const body = document.createElement('div');
  body.className = 'qbody';
  renderContent(body, question.canonicalText);
  parent.appendChild(body);
}

/**
 * Answer view: photograph and/or type → transcribe → confirm/edit → grade.
 * `onDone` is called after a successful Save attempt (Sliver 6). The chat transcript
 * lives in memory and is lost on reload, by design.
 */
export function renderAnswerView(host: HTMLElement, question: Question, onDone: () => void): void {
  host.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'card learn-grade';
  host.appendChild(wrap);
  renderQuestionHeader(wrap, question);

  const pickedFiles: File[] = [];

  // --- Answer step ---
  const step = document.createElement('div');
  step.className = 'learn-answer-step';
  wrap.appendChild(step);

  const typed = document.createElement('textarea');
  typed.className = 'learn-typed';
  typed.placeholder = 'Type your answer (optional if you attach a photo)…';
  step.appendChild(typed);

  const imageInput = createImageInput({
    multiple: true,
    onFiles: (files) => {
      pickedFiles.push(...files);
      fileList.textContent = `${pickedFiles.length} photo(s) attached`;
      updateContinue();
    },
  });
  step.appendChild(imageInput.element);

  const fileList = document.createElement('div');
  fileList.className = 'status learn-files';
  step.appendChild(fileList);

  const transcribeBtn = document.createElement('button');
  transcribeBtn.className = 'btn learn-transcribe';
  transcribeBtn.textContent = 'Transcribe & continue';
  transcribeBtn.disabled = true;
  step.appendChild(transcribeBtn);

  const error = document.createElement('div');
  error.className = 'error learn-error';
  wrap.appendChild(error);

  function updateContinue(): void {
    transcribeBtn.disabled = pickedFiles.length === 0 && typed.value.trim() === '';
  }
  typed.addEventListener('input', updateContinue);

  transcribeBtn.addEventListener('click', () => {
    error.textContent = '';
    transcribeBtn.disabled = true;
    imageInput.setDisabled(true);
    void (async () => {
      try {
        let transcription = '';
        let imagePaths: string[] = [];
        if (pickedFiles.length > 0) {
          transcribeBtn.textContent = 'Transcribing…';
          const out = await api.transcribeAnswer(question.id, pickedFiles);
          transcription = out.transcription;
          imagePaths = out.imagePaths;
        }
        renderConfirmStep(wrap, question, {
          answerText: typed.value.trim(),
          transcription,
          imagePaths,
          onDone,
        });
        step.remove();
      } catch {
        error.textContent = 'Transcription failed — try again.';
        transcribeBtn.disabled = false;
        imageInput.setDisabled(false);
        transcribeBtn.textContent = 'Transcribe & continue';
      }
    })();
  });
}

interface ConfirmState {
  answerText: string;
  transcription: string;
  imagePaths: string[];
  onDone: () => void;
}

/** Confirm/edit step: editable transcription + typed answer, then grade. */
function renderConfirmStep(wrap: HTMLElement, question: Question, state: ConfirmState): void {
  const confirm = document.createElement('div');
  confirm.className = 'learn-confirm';
  wrap.appendChild(confirm);

  const tLabel = document.createElement('label');
  tLabel.textContent = 'Transcription (edit if the scan is wrong):';
  const transcription = document.createElement('textarea');
  transcription.className = 'learn-transcription';
  transcription.value = state.transcription;

  const aLabel = document.createElement('label');
  aLabel.textContent = 'Typed answer:';
  const answer = document.createElement('textarea');
  answer.className = 'learn-typed-confirm';
  answer.value = state.answerText;

  const gradeBtn = document.createElement('button');
  gradeBtn.className = 'btn learn-grade-go';
  gradeBtn.textContent = 'Looks good — grade it';

  confirm.append(tLabel, transcription, aLabel, answer, gradeBtn);

  gradeBtn.addEventListener('click', () => {
    const combined = [answer.value.trim(), transcription.value.trim()]
      .filter((s) => s !== '')
      .join('\n\n');
    confirm.remove();
    renderGradingView(wrap, question, {
      combinedAnswer: combined,
      answerText: answer.value.trim(),
      transcription: transcription.value.trim(),
      imagePaths: state.imagePaths,
      onDone: state.onDone,
    });
  });
}

// renderGradingView + GRADES badge helpers are added in Sliver 6 (Task 14).
// For Task 12, stub it so the confirm step compiles and the typed-only test reaches confirm:
interface GradingState {
  combinedAnswer: string;
  answerText: string;
  transcription: string;
  imagePaths: string[];
  onDone: () => void;
}
function renderGradingView(_wrap: HTMLElement, _question: Question, _state: GradingState): void {
  // Replaced in Task 14. Intentionally minimal so Sliver 5 is observable
  // (answer → transcribe → confirm) without grading.
}

/** Learn tab — temporary chooser until Sliver 6/7 add the suggestion card + navigator. */
export function renderLearn(host: HTMLElement): void {
  host.innerHTML = '<h2>Learn</h2><p>Suggested-next card and navigator coming next.</p>';
}
```

Note: the `renderGradingView` stub and `GRADES` are placeholders consumed in Task 14; `GRADES`/`Message` may be flagged unused by the linter in this task — that's acceptable as they are wired up in Task 14 (or temporarily prefix-underscore / add an eslint-disable; do not delete, Task 14 needs them).

- [ ] **Step 6: Add style hooks to `styles.css`** — append only the hooks not already present (check first for `.card`, `.row`, `.error`):

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
.learn-confirm label { display: block; margin-top: 0.5rem; font-size: 0.85rem; color: #555; }
.image-input { display: inline-flex; gap: 0.5rem; }
.error { color: #b00; }
```

- [ ] **Step 7: Run test to verify it passes** — `npm test -- packages/client/src/tabs/learn.dom.test.ts` → PASS (2 tests).

- [ ] **Step 8: Full suite + typecheck** — PASS.

- [ ] **Step 9: Verify in the browser** — the full loop isn't reachable from the Learn tab until Sliver 7 wires navigation. To verify Sliver 5 now, temporarily call `renderAnswerView(host, knownQuestion, () => {})` from `renderLearn` with a question fetched via the API (or wait for Task 16). At minimum, confirm `npm run dev` builds with no console errors on the Learn tab. (Optional manual check: in DevTools, call the answer view against a real question id and transcribe `~/Downloads/1-A-2_solution.jpg` — confirm the transcription appears and is editable.)

- [ ] **Step 10: Commit**
```
git add packages/client/src/api/types.ts packages/client/src/api/client.ts packages/client/src/tabs/learn.ts packages/client/src/tabs/learn.dom.test.ts packages/client/src/styles.css
git commit -F <commit-msg-file>
```
Message: `feat: Learn answer/transcribe/confirm view + client API for grading`

---

# SLIVER 6 — `/grade` + grading contract; grading chat + rating + Save attempt

*Observable when done: full photo→transcribe→confirm→grade→rate→save loop in the browser.*

### Task 13: Grading contract + `POST /api/questions/:id/grade` (stateless replay)

**Files:**
- Create: `packages/server/src/llm/grading-contract.ts`
- Create: `packages/server/src/llm/grading-contract.test.ts`
- Create: `packages/server/src/routes/grade.ts`
- Create: `packages/server/src/routes/grade.test.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Write the failing grading-contract test**

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

  it('constrains the grader to react, not solve, and grade only this question', () => {
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

- [ ] **Step 2: Run test to verify it fails** — FAIL (module missing).

- [ ] **Step 3: Write the grading contract**

```ts
// packages/server/src/llm/grading-contract.ts

/** Context the grader is given about the question being answered. */
export interface GradingContext {
  canonicalText: string;
  chapterDescription?: string;
  bookLearningGoal?: string;
}

/**
 * The system-framing prompt for a grading conversation. Provider-agnostic. Sent as the
 * first `user` message ahead of the live transcript; the schema forces a recommended
 * grade on every turn including the first.
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

- [ ] **Step 4: Run grading-contract test** — PASS (5 tests).

- [ ] **Step 5: Write the failing grade-route test**

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
      .send({ conversation: [{ role: 'user', text: 'x^2/2' }] });
    expect(res.status).toEqual(200);
    expect(res.body).toEqual({
      critiqueText: 'Good start, but check the constant.',
      recommendedGrade: 'partial',
    });
    // First message is the grading prompt; the client transcript follows.
    expect(provider.lastConversation[0]?.role).toEqual('user');
    expect(provider.lastConversation.at(-1)?.text).toEqual('x^2/2');
  });

  it('404 for an unknown question', async () => {
    const res = await request(app)
      .post('/api/questions/nope/grade')
      .send({ conversation: [{ role: 'user', text: 'x' }] });
    expect(res.status).toEqual(404);
  });

  it('400 when the conversation is empty', async () => {
    const res = await request(app).post(`/api/questions/${questionId}/grade`).send({ conversation: [] });
    expect(res.status).toEqual(400);
  });

  it('400 when conversation is malformed', async () => {
    const res = await request(app)
      .post(`/api/questions/${questionId}/grade`)
      .send({ conversation: [{ role: 'system', text: 'x' }] });
    expect(res.status).toEqual(400);
  });

  it('502 when the provider fails', async () => {
    provider.failWith(new LlmError('down'));
    const res = await request(app)
      .post(`/api/questions/${questionId}/grade`)
      .send({ conversation: [{ role: 'user', text: 'x' }] });
    expect(res.status).toEqual(502);
  });
});
```

- [ ] **Step 6: Write the grade router**

```ts
// packages/server/src/routes/grade.ts
import { Router } from 'express';
import {
  buildGradingPrompt,
  gradingTurnSchema,
  type GradingContext,
} from '../llm/grading-contract.js';
import { LlmError, type LlmProvider, type Message, type Role } from '../llm/provider.js';
import type { Store } from '../storage/store.js';

const ROLES: readonly Role[] = ['user', 'assistant'];

/** Validate a client-sent transcript into Message[] (text + role only). */
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
    const transcript = parseConversation((req.body ?? {}).conversation);
    if (transcript === undefined) {
      res.status(400).json({ error: 'conversation must be an array of {role, text}' });
      return;
    }
    if (transcript.length === 0) {
      res.status(400).json({ error: 'conversation must not be empty' });
      return;
    }

    const chapter = store.chapters.getById(question.chapterId);
    const book = chapter ? store.books.getById(chapter.bookId) : undefined;
    const ctx: GradingContext = {
      canonicalText: question.canonicalText,
      ...(chapter?.description !== undefined ? { chapterDescription: chapter.description } : {}),
      ...(book?.learningGoal !== undefined ? { bookLearningGoal: book.learningGoal } : {}),
    };

    const messages: Message[] = [{ role: 'user', text: buildGradingPrompt(ctx) }, ...transcript];

    try {
      const turn = await provider.completeStructured<{
        critiqueText: string;
        recommendedGrade: string;
      }>(messages, gradingTurnSchema);
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

- [ ] **Step 7: Mount it in `index.ts`**
```ts
import { questionGradeRouter } from './routes/grade.js';
```
```ts
  app.use('/api/questions/:id/grade', questionGradeRouter(store, provider));
```

- [ ] **Step 8: Run grade-route test + full suite** — `npm test -- packages/server/src/routes/grade.test.ts && npm run typecheck && npm test` → PASS.

- [ ] **Step 9: Commit**
```
git add packages/server/src/llm/grading-contract.ts packages/server/src/llm/grading-contract.test.ts packages/server/src/routes/grade.ts packages/server/src/routes/grade.test.ts packages/server/src/index.ts
git commit -F <commit-msg-file>
```
Message: `feat: grading contract + stateless POST /api/questions/:id/grade`

---

### Task 14: Grading chat + rating + Save attempt (client)

Replace the `renderGradingView` stub from Task 12 with the real chat view: first user turn = the combined answer; each LLM turn renders critique + a recommended-grade badge; a reply box re-grades; a rating control (accept/override) → Save attempt POSTs to `/attempts`.

**Files:**
- Modify: `packages/client/src/tabs/learn.ts`
- Modify: `packages/client/src/tabs/learn.dom.test.ts`

- [ ] **Step 1: Extend the DOM test**

```ts
// add to learn.dom.test.ts
import { renderGradingView } from './learn.js'; // now exported

describe('grading chat', () => {
  const gradingState = {
    combinedAnswer: '2',
    answerText: '2',
    transcription: '',
    imagePaths: ['images/a.png'],
    onDone: () => {},
  };

  it('grades the combined answer on open and shows a grade badge', async () => {
    const host = document.createElement('div');
    renderGradingView(host, question, { ...gradingState });
    await vi.waitFor(() => expect(host.querySelector('.grade-badge')).not.toBeNull());
    expect(api.gradeTurn).toHaveBeenCalledWith('q1', {
      conversation: [{ role: 'user', text: '2' }],
    });
    expect(host.querySelector('.grade-badge')!.textContent).toMatch(/partial/i);
  });

  it('saves an attempt with photos + transcription + recommended grade by default', async () => {
    const onDone = vi.fn();
    const host = document.createElement('div');
    renderGradingView(host, question, { ...gradingState, onDone });
    await vi.waitFor(() => expect(host.querySelector('.learn-save')).not.toBeNull());
    host.querySelector<HTMLButtonElement>('.learn-save')!.click();
    await vi.waitFor(() => expect(api.createAttempt).toHaveBeenCalled());
    expect(api.createAttempt).toHaveBeenCalledWith('q1', {
      imagePaths: ['images/a.png'],
      answerText: '2',
      transcription: '',
      recommendedGrade: 'partial',
      rating: 'partial',
      critiqueText: 'Almost!',
    });
    expect(onDone).toHaveBeenCalled();
  });

  it('reply box sends a follow-up turn with the full conversation', async () => {
    const host = document.createElement('div');
    renderGradingView(host, question, { ...gradingState });
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

- [ ] **Step 2: Run test to verify it fails** — FAIL (`renderGradingView` is the stub / not exported).

- [ ] **Step 3: Replace the `renderGradingView` stub** with the real implementation (and `export` it). It auto-grades on open using `state.combinedAnswer` as the first user turn:

```ts
/** Append a grade badge into `host`. */
function appendBadge(host: HTMLElement, grade: Grade): void {
  const badge = document.createElement('span');
  badge.className = `badge grade-badge grade-${grade}`;
  badge.textContent = grade;
  host.appendChild(badge);
}

interface GradingState {
  combinedAnswer: string;
  answerText: string;
  transcription: string;
  imagePaths: string[];
  onDone: () => void;
}

/**
 * Grading chat: auto-grades the combined answer on open, renders critique + a grade
 * badge per turn, a reply box to clarify (re-grades), and a rating control → Save
 * attempt. The transcript lives in memory and is lost on reload, by design.
 */
export function renderGradingView(wrap: HTMLElement, question: Question, state: GradingState): void {
  const conversation: Message[] = [];
  let lastGrade: Grade | undefined;
  let lastCritique = '';

  const chat = document.createElement('div');
  chat.className = 'chat grade-chat';
  wrap.appendChild(chat);

  const error = document.createElement('div');
  error.className = 'error grade-error';
  wrap.appendChild(error);

  const replyHost = document.createElement('div');
  replyHost.className = 'row learn-reply-row';
  wrap.appendChild(replyHost);

  const ratingHost = document.createElement('div');
  ratingHost.className = 'row learn-rating-row';
  wrap.appendChild(ratingHost);

  function appendTurn(role: 'user' | 'assistant', text: string, grade?: Grade): void {
    const msg = document.createElement('div');
    msg.className = `msg msg-${role}`;
    const span = document.createElement('span');
    span.textContent = text;
    msg.appendChild(span);
    if (grade) appendBadge(msg, grade);
    chat.appendChild(msg);
  }

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
    const save = document.createElement('button');
    save.className = 'btn learn-save';
    save.textContent = 'Save attempt';
    save.addEventListener('click', () => {
      void (async () => {
        await api.createAttempt(question.id, {
          imagePaths: state.imagePaths,
          answerText: state.answerText,
          transcription: state.transcription,
          recommendedGrade: lastGrade!,
          rating: select.value as Grade,
          critiqueText: lastCritique,
        });
        state.onDone();
      })();
    });
    ratingHost.append(select, save);
  }

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
      void grade(text, send);
    });
    replyHost.append(reply, send);
  }

  /** Push a user turn, call the grader, render the result. */
  async function grade(userText: string, control: HTMLButtonElement): Promise<void> {
    error.textContent = '';
    control.disabled = true;
    conversation.push({ role: 'user', text: userText });
    appendTurn('user', userText);
    try {
      const turn = await api.gradeTurn(question.id, { conversation });
      conversation.push({ role: 'assistant', text: turn.critiqueText });
      appendTurn('assistant', turn.critiqueText, turn.recommendedGrade);
      lastGrade = turn.recommendedGrade;
      lastCritique = turn.critiqueText;
      renderRating();
      ensureReplyBox();
    } catch {
      error.textContent = 'Grading failed — try again.';
      conversation.pop(); // keep the transcript valid for a retry
    } finally {
      control.disabled = false;
    }
  }

  // Auto-grade the combined answer on open.
  const opener = document.createElement('button');
  opener.style.display = 'none';
  wrap.appendChild(opener);
  void grade(state.combinedAnswer, opener);
}
```

Remove the Task-12 placeholder `renderGradingView` stub and its `GradingState` duplicate (this version supersedes them). Keep the `GRADES`/`Message` imports — now used.

- [ ] **Step 4: Run test to verify it passes** — `npm test -- packages/client/src/tabs/learn.dom.test.ts` → PASS (answer + grading suites).

- [ ] **Step 5: Full suite + typecheck** — PASS.

- [ ] **Step 6: Commit**
```
git add packages/client/src/tabs/learn.ts packages/client/src/tabs/learn.dom.test.ts
git commit -F <commit-msg-file>
```
Message: `feat: Learn grading chat — critique, badge, reply, rating, save`

---

# SLIVER 7 — Skip/snooze PATCH + `learn/next` + suggested-next card + navigator

*Observable when done: suggested-next, Skip/Not now, and pick-your-own all work in the browser.*

### Task 15: Widen the question PATCH for skip/snooze; `learn/next` service + route

**Files:**
- Modify: `packages/server/src/routes/questions.ts`
- Modify: `packages/server/src/routes/questions.test.ts`
- Create: `packages/server/src/services/learn-next.ts`
- Create: `packages/server/src/services/learn-next.test.ts`
- Create: `packages/server/src/routes/learn.ts`
- Create: `packages/server/src/routes/learn.test.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Write the failing PATCH test** — add to `packages/server/src/routes/questions.test.ts`:

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

(If `questions.test.ts` doesn't already define `chapterId` in scope, follow its existing setup to create a book+chapter first — mirror the neighbouring tests.)

- [ ] **Step 2: Run test to verify it fails** — FAIL (PATCH ignores the new fields).

- [ ] **Step 3: Widen the PATCH handler** — in `packages/server/src/routes/questions.ts`, replace the patch-building block in `questionsRouter`'s `PATCH /:id`. Because `JsonCollection.update` shallow-merges and **cannot remove a key**, the clear-snooze branch deletes + re-creates with the same id:

```ts
    const { canonicalText, label, skipped, snoozedUntil } = req.body ?? {};

    // Clear-snooze: delete + re-create without the field (merge can't remove a key).
    if (snoozedUntil === null) {
      const current = store.questions.getById(req.params.id)!;
      const { snoozedUntil: _drop, ...rest } = current;
      const rebuilt: Question = { ...rest };
      if (typeof canonicalText === 'string') rebuilt.canonicalText = canonicalText.trim();
      if (typeof label === 'string') rebuilt.label = label.trim();
      if (typeof skipped === 'boolean') rebuilt.skipped = skipped;
      store.questions.delete(req.params.id);
      res.json(store.questions.create(rebuilt));
      return;
    }

    const patch: Partial<Omit<Question, 'id'>> = {};
    if (typeof canonicalText === 'string') patch.canonicalText = canonicalText.trim();
    if (typeof label === 'string') patch.label = label.trim();
    if (typeof skipped === 'boolean') patch.skipped = skipped;
    if (typeof snoozedUntil === 'string') patch.snoozedUntil = snoozedUntil;
    res.json(store.questions.update(req.params.id, patch));
```

(`learn/next` sorts by chapter/createdAt, not array position, so the re-created item moving to the end is safe.)

- [ ] **Step 4: Run PATCH test** — PASS.

- [ ] **Step 5: Write the failing `learn-next` service test**

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

function addQuestion(text: string, createdAt: string): string {
  return store.questions.create({
    id: text,
    chapterId,
    canonicalText: text,
    source: { kind: 'text' },
    createdAt,
  }).id;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-next-'));
  store = await Store.open(dir);
  bookId = store.books.create({ id: 'b1', title: 'B', createdAt: '2026-01-01T00:00:00.000Z' }).id;
  chapterId = store.chapters.create({
    id: 'c1',
    bookId,
    title: 'C',
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  }).id;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('suggestNext', () => {
  it('returns the earliest un-attempted question with its book + chapter', () => {
    addQuestion('q-late', '2026-02-02T00:00:00.000Z');
    addQuestion('q-early', '2026-01-15T00:00:00.000Z');
    const next = suggestNext(store, '2026-06-07T00:00:00.000Z');
    expect(next?.question.id).toEqual('q-early');
    expect(next?.book.id).toEqual('b1');
    expect(next?.chapter.id).toEqual('c1');
  });

  it('excludes attempted questions', () => {
    const id = addQuestion('q', '2026-01-15T00:00:00.000Z');
    store.attempts.create({
      id: 'a1',
      questionId: id,
      imagePaths: [],
      answerText: 'x',
      transcription: '',
      recommendedGrade: 'correct',
      rating: 'correct',
      critiqueText: '',
      createdAt: '2026-01-16T00:00:00.000Z',
    });
    expect(suggestNext(store, '2026-06-07T00:00:00.000Z')).toBeUndefined();
  });

  it('excludes skipped questions', () => {
    const id = addQuestion('q', '2026-01-15T00:00:00.000Z');
    store.questions.update(id, { skipped: true });
    expect(suggestNext(store, '2026-06-07T00:00:00.000Z')).toBeUndefined();
  });

  it('excludes actively-snoozed questions but re-includes after expiry', () => {
    const id = addQuestion('q', '2026-01-15T00:00:00.000Z');
    store.questions.update(id, { snoozedUntil: '2026-06-08T00:00:00.000Z' });
    expect(suggestNext(store, '2026-06-07T00:00:00.000Z')).toBeUndefined();
    expect(suggestNext(store, '2026-06-09T00:00:00.000Z')?.question.id).toEqual(id);
  });

  it('orders by chapter.order then createdAt', () => {
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
    addQuestion('q-c1', '2026-02-01T00:00:00.000Z');
    expect(suggestNext(store, '2026-06-07T00:00:00.000Z')?.question.id).toEqual('q-c1');
  });
});
```

- [ ] **Step 6: Write the service**

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
 * The next question to suggest: un-attempted, not skipped, not actively snoozed,
 * ordered by book order → chapter.order → question.createdAt. `now` is passed in so
 * the query is pure/testable. Returns undefined when nothing is eligible.
 */
export function suggestNext(store: Store, now: string): LearnNext | undefined {
  const attempted = new Set(store.attempts.getAll().map((a) => a.questionId));
  const books = store.books.getAll();
  const bookOrder = new Map(books.map((b, i) => [b.id, i]));
  const chapterById = new Map(store.chapters.getAll().map((c) => [c.id, c]));

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

- [ ] **Step 7: Run service test** — PASS (5 tests).

- [ ] **Step 8: Write the failing route test**

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

- [ ] **Step 9: Write the route + mount it**

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
    res.json(next ?? { question: null });
  });
  return router;
}
```
```ts
import { learnRouter } from './routes/learn.js';
```
```ts
  app.use('/api/learn', learnRouter(store));
```

- [ ] **Step 10: Run route test + full suite** — `npm run typecheck && npm test` → PASS.

- [ ] **Step 11: Commit**
```
git add packages/server/src/routes/questions.ts packages/server/src/routes/questions.test.ts packages/server/src/services/learn-next.ts packages/server/src/services/learn-next.test.ts packages/server/src/routes/learn.ts packages/server/src/routes/learn.test.ts packages/server/src/index.ts
git commit -F <commit-msg-file>
```
Message: `feat: skip/snooze PATCH + learn/next service and GET /api/learn/next`

---

### Task 16: Suggested-next card + navigator (client) — full loop reachable

**Files:**
- Modify: `packages/client/src/tabs/learn.ts`
- Modify: `packages/client/src/tabs/learn.dom.test.ts`

- [ ] **Step 1: Extend the DOM test** (the mock already has `getLearnNext`, `patchQuestionState`, `listBooks`, `getBookTree`):

```ts
describe('suggested-next card + navigator', () => {
  const suggestion = {
    question,
    book: { id: 'b1', title: 'B', createdAt: '' },
    chapter: { id: 'c1', bookId: 'b1', title: 'C', order: 0, createdAt: '' },
  };

  it('renders the suggested question with Answer / Skip / Not now', async () => {
    (api.getLearnNext as ReturnType<typeof vi.fn>).mockResolvedValue(suggestion);
    const host = document.createElement('div');
    renderLearn(host);
    await vi.waitFor(() => expect(host.querySelector('.learn-suggestion')).not.toBeNull());
    expect(host.querySelector('.learn-answer')).not.toBeNull();
    expect(host.querySelector('.learn-skip')).not.toBeNull();
    expect(host.querySelector('.learn-snooze')).not.toBeNull();
  });

  it('shows an empty state when there is no suggestion', async () => {
    (api.getLearnNext as ReturnType<typeof vi.fn>).mockResolvedValue({ question: null });
    (api.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const host = document.createElement('div');
    renderLearn(host);
    await vi.waitFor(() => expect(host.textContent).toMatch(/all caught up|nothing/i));
  });

  it('Skip patches skipped:true and reloads', async () => {
    (api.getLearnNext as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(suggestion)
      .mockResolvedValueOnce({ question: null });
    (api.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const host = document.createElement('div');
    renderLearn(host);
    await vi.waitFor(() => expect(host.querySelector('.learn-skip')).not.toBeNull());
    host.querySelector<HTMLButtonElement>('.learn-skip')!.click();
    await vi.waitFor(() =>
      expect(api.patchQuestionState).toHaveBeenCalledWith('q1', { skipped: true }),
    );
  });

  it('navigator drills book → chapter → question and opens the answer view', async () => {
    (api.getLearnNext as ReturnType<typeof vi.fn>).mockResolvedValue({ question: null });
    (api.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'b1', title: 'B', createdAt: '' },
    ]);
    (api.getBookTree as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'b1',
      title: 'B',
      createdAt: '',
      chapters: [
        { id: 'c1', bookId: 'b1', title: 'C', order: 0, createdAt: '', questions: [question] },
      ],
    });
    const host = document.createElement('div');
    renderLearn(host);
    await vi.waitFor(() => expect(host.querySelector('.learn-nav-book')).not.toBeNull());
    host.querySelector<HTMLButtonElement>('.learn-nav-book')!.click();
    await vi.waitFor(() => expect(host.querySelector('.learn-nav-chapter')).not.toBeNull());
    host.querySelector<HTMLButtonElement>('.learn-nav-chapter')!.click();
    await vi.waitFor(() => expect(host.querySelector('.learn-nav-question')).not.toBeNull());
    host.querySelector<HTMLButtonElement>('.learn-nav-question')!.click();
    await vi.waitFor(() => expect(host.querySelector('.learn-grade')).not.toBeNull());
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL (`renderLearn` is still the stub).

- [ ] **Step 3: Implement `renderLearn` (suggestion card + navigator)** — replace the stub:

```ts
import type { Book } from '../api/types.js';

/** Learn tab: suggested-next card on top, then a browse navigator. */
export function renderLearn(host: HTMLElement): void {
  host.innerHTML = '';
  const heading = document.createElement('h2');
  heading.textContent = 'Learn';
  host.appendChild(heading);

  const cardHost = document.createElement('div');
  host.appendChild(cardHost);

  const navHost = document.createElement('div');
  navHost.className = 'learn-nav';
  host.appendChild(navHost);

  function openAnswer(q: Question): void {
    host.innerHTML = '';
    renderAnswerView(host, q, () => renderLearn(host));
  }

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
      } else {
        renderSuggestion(cardHost, next.question, reload, openAnswer);
      }
    })();
  }

  reload();
  void renderNavigator(navHost, openAnswer);
}

/** Suggested-next card: question preview + Answer / Skip / Not now. */
function renderSuggestion(
  host: HTMLElement,
  question: Question,
  reload: () => void,
  openAnswer: (q: Question) => void,
): void {
  const card = document.createElement('div');
  card.className = 'card learn-suggestion';
  host.appendChild(card);
  renderQuestionHeader(card, question);

  const row = document.createElement('div');
  row.className = 'row';
  card.appendChild(row);

  const answer = document.createElement('button');
  answer.className = 'btn learn-answer';
  answer.textContent = 'Answer';
  answer.addEventListener('click', () => openAnswer(question));

  const skip = document.createElement('button');
  skip.className = 'link learn-skip';
  skip.textContent = 'Skip';
  skip.addEventListener('click', () => {
    void api.patchQuestionState(question.id, { skipped: true }).then(reload);
  });

  const snooze = document.createElement('button');
  snooze.className = 'link learn-snooze';
  snooze.textContent = 'Not now';
  snooze.addEventListener('click', () => {
    const until = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    void api.patchQuestionState(question.id, { snoozedUntil: until }).then(reload);
  });

  row.append(answer, skip, snooze);
}

/** Book → chapter → question drill-down; calls `onPick` with the chosen question. */
async function renderNavigator(host: HTMLElement, onPick: (q: Question) => void): Promise<void> {
  host.innerHTML = '';
  const h = document.createElement('h3');
  h.textContent = 'Browse';
  host.appendChild(h);
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
  host.innerHTML = '';
  const h = document.createElement('h3');
  h.textContent = book.title;
  host.appendChild(h);
  const tree = await api.getBookTree(book.id);
  for (const chapter of tree.chapters) {
    const chBtn = document.createElement('button');
    chBtn.className = 'link learn-nav-chapter';
    chBtn.textContent = chapter.title;
    chBtn.addEventListener('click', () => {
      const list = document.createElement('div');
      list.className = 'learn-nav-questions';
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

(All titles use `textContent` — never `innerHTML` — so user-entered titles can't inject markup.)

- [ ] **Step 4: Run test to verify it passes** — PASS (suggestion + navigator + earlier grading/answer suites).

- [ ] **Step 5: Full suite + typecheck** — `npm run typecheck && npm test` → PASS across server + client.

- [ ] **Step 6: Verify the full loop in the browser** — `npm run dev`. On Learn:
  - A suggested question appears (or "All caught up").
  - **Answer** → attach `~/Downloads/1-A-2_solution.jpg` (Take photo / Choose image) and/or type → **Transcribe & continue** → see the editable transcription → **Looks good — grade it** → critique + grade badge → optionally reply to clarify (re-grades) → pick rating → **Save attempt** → returns to the (advanced) suggestion.
  - **Skip** / **Not now** advance and exclude appropriately.
  - **Browse** drills book → chapter → question and opens the answer view.

- [ ] **Step 7: Commit**
```
git add packages/client/src/tabs/learn.ts packages/client/src/tabs/learn.dom.test.ts
git commit -F <commit-msg-file>
```
Message: `feat: Learn suggested-next card + navigator — full loop reachable`

---

## Final verification

- [ ] `npm run typecheck && npm test` — all green.
- [ ] `npm run dev` and walk the full loop end-to-end per the spec's "Client / UI (Learn tab)" section: suggested-next card (Answer/Skip/Not now + empty state), navigator drill-down, answer step (photo + typed), transcribe → editable confirm, grading chat with per-turn grade badges + clarification reply, rating accept/override, Save attempt advancing the suggestion — exercised with `~/Downloads/1-A-2_solution.jpg`.
- [ ] Confirm extraction (Sliver 1 refactor + Sliver 4 component migration) still works from Manage with `~/Downloads/test_problems_01.jpg`.

---

## Self-review notes (author)

- **Spec coverage (build order 1–7):**
  - Sliver 1 = general `LlmProvider` + `ImageRef` + extraction refactor onto `completeStructured` (spec §"LLM conversational interface", order 1).
  - Sliver 2 = always-present label (spec §"Label-extraction improvement", order 2).
  - Sliver 3 = `Attempt` model (with `imagePaths`/`transcription`) + store + `/attempts` with the photo-or-typed invariant (spec §"Data model", §API `/attempts`, order 3).
  - Sliver 4 = reusable image-input component + extraction-pane migration (spec §"Reusable image input", order 4).
  - Sliver 5 = transcription contract + `/transcribe` + answer→transcribe→confirm view (spec §"Transcription contract", §API `/transcribe`, §"Client/UI" steps, order 5).
  - Sliver 6 = grading contract + `/grade` (body `{conversation}`) + grading chat + rating + Save (spec §"Grading contract", §API `/grade` + `/attempts`, order 6).
  - Sliver 7 = skip/snooze PATCH + `learn/next` + suggested-next card + navigator (spec §"Skip/snooze", §"Suggested next", §"Client/UI", order 7).
- **Photo-first vs typed-first (the reason for this rewrite):** transcription is in the slice (Sliver 5); the grade route takes `{conversation}` only (the combined answer is the first client turn, built in the confirm step); `Attempt` carries `imagePaths`/`transcription`; the `/attempts` invariant is photo-OR-typed; the image-input component is multi-file and reused.
- **Deferred (correctly out of scope):** SRS scheduler, grading-chat KaTeX rendering, persisting the full critique transcript, provider/key/model config UI, live in-app camera capture — all spec-listed deferrals.
- **Type consistency:** `Grade`, `Message`/`Role`, `Attempt`, `GradeTurn`, `TranscribeResult`, `LearnNext` defined once server-side and mirrored client-side. `transcribeAnswer`/`gradeTurn`/`createAttempt`/`listAttempts`/`patchQuestionState`/`getLearnNext` names are used consistently across Tasks 12, 14, 16. `renderAnswerView(host, question, onDone)` and `renderGradingView(wrap, question, state)` signatures are consistent across Tasks 12, 14, 16.
- **Known risks flagged inline:** (a) `JsonCollection.update` shallow-merges and cannot delete a key — Task 15 clears snooze via delete+create with the same id (verified against `json-collection.ts`). (b) Task 12 introduces a temporary `renderGradingView` stub so the confirm step compiles before Sliver 6; Task 14 replaces it and exports the real one — `GRADES`/`Message` are kept (used by Task 14). (c) Titles in the navigator use `textContent`, not `innerHTML`, to avoid markup injection.
```
