# Foundation: LLM Image Ingestion (Manage tab, Step 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user inside a chapter upload a photo of a textbook page; the server stores the image, shells out to the Claude Code CLI to extract each distinct question into LaTeX, and commits the extracted questions under the chapter (extract-and-commit, no review gate).

**Architecture:** A thin `LlmProvider` interface with a single `extractQuestionsFromImage` operation, fed a centrally-authored **extraction contract** (prompt + JSON schema). Production wires a `ClaudeCliProvider` that `execFile`s the `claude` CLI; tests wire a deterministic `FakeProvider`. Images land under `~/.question-bank/images/` via an `ImageStore` that mirrors the existing `Store` conventions. A new `POST /api/chapters/:chapterId/questions/extract` multipart endpoint orchestrates store → contract → provider → create. The Manage questions pane gains an "Extract from image" control.

**Tech Stack:** TypeScript (strict ESM), Express 4, Node ≥ 20 (`crypto.randomUUID`, `node:child_process`), `multer` (memory storage) as the one new server dependency, Vitest 2, vanilla-TS Vite client.

**Scope notes (read before starting):**
- This plan covers **only Step 2 (LLM image ingestion)** of the foundation sub-project. KaTeX rendering / P0 polish (Step 3) is out of scope and gets its own plan.
- **Image modality only.** Text-input extraction (`extractQuestionsFromText`) is deferred.
- **Extract-and-commit, no review/staging gate.** A gate is a deferred candidate "if extraction proves noisy."
- This build ships a **narrow** `extractQuestionsFromImage`, NOT the architecture doc's generic `complete` / `completeStructured(Message[], Schema)`. The generic surface is introduced later (with grading). Keep the provider thin so generalization is additive.
- Source-of-truth specs: `docs/superpowers/specs/2026-06-07-llm-image-ingestion-design.md` and `docs/superpowers/specs/2026-06-06-question-bank-architecture.md`. The Step-1 plan (`docs/superpowers/plans/2026-06-06-foundation-registration.md`) established the conventions this plan extends.

**Repo conventions (from `AGENTS.md` / Step-1 plan, must follow):**
- TypeScript everywhere, strict mode on (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Never loosen tsconfig to silence errors — fix the code. Optional fields are added via conditional spread, never assigned `undefined`.
- ESM only (`"type": "module"`); `import`/`export` with `.js` extensions on relative imports.
- Framework-free client. No React/Vue/Svelte, no CSS framework, no state-management lib.
- Storage owns its own directory and lazy-creates it; mirror `Store`/`JsonCollection`.
- Co-locate tests as `*.test.ts` next to the code they cover.
- Run everything from the repo root. `npm run typecheck` and `npm test` before declaring work done.
- IDs are `crypto.randomUUID()`. Timestamps are `new Date().toISOString()`.

**Existing scaffold this plan extends (already present — do not recreate):**
- `packages/server/src/index.ts` exports `createApp(store)` (a factory; `listen` is guarded for the real entry point) and derives `DATA_DIR = process.env.QB_DATA_DIR ?? join(homedir(), '.question-bank')`.
- `packages/server/src/routes/questions.ts` exports `chapterQuestionsRouter(store)` (nested list+create under `/api/chapters/:chapterId/questions`) and `questionsRouter(store)` (flat patch/delete). The extract route is added to `chapterQuestionsRouter`.
- `packages/server/src/storage/store.ts` — `Store.open(dataDir)` with `books`/`chapters`/`questions` repos.
- `packages/server/src/domain/types.ts` — `Question` + `QuestionSource { kind: 'image' | 'text'; imagePath?; rawText? }`. **No schema changes needed** — extracted questions populate the existing shape with `source.kind = 'image'`.
- `packages/client/src/api/client.ts` — the `api` object; `packages/client/src/manage/questions-pane.ts` — `renderQuestionsPane(...)` with an inline add row.
- `supertest` + `@types/supertest` already in `packages/server` devDependencies.

---

## File Structure

**Server (`packages/server/src/`):**
- `llm/provider.ts` — the `LlmProvider` interface + DTOs (`ExtractedQuestion`, `ExtractionRequest`) + the typed `LlmError`.
- `llm/extraction-contract.ts` — the central, provider-agnostic extraction **prompt** and JSON **schema** (the domain "what to ask").
- `llm/fake-provider.ts` — `FakeProvider`: deterministic, configurable results (and configurable throw) for tests.
- `llm/claude-cli-provider.ts` — `ClaudeCliProvider`: `execFile`s the real `claude` CLI, parses its JSON envelope, validates, returns `ExtractedQuestion[]`.
- `storage/images.ts` — `ImageStore`: owns `<dataDir>/images/`, `save(buffer, ext)` writes `<uuid>.<ext>`.
- `routes/questions.ts` (modify) — add `POST /extract` to `chapterQuestionsRouter`, which now takes `(store, provider, imageStore)`.
- `index.ts` (modify) — `createApp(store, provider, imageStore)`; `main()` injects `ClaudeCliProvider` + a real `ImageStore`.
- Tests co-located: `llm/fake-provider.test.ts`, `llm/claude-cli-provider.test.ts`, `storage/images.test.ts`, `routes/questions-extract.test.ts`.

**Client (`packages/client/src/`):**
- `api/client.ts` (modify) — add `extractQuestionsFromImage(chapterId, file)`.
- `manage/questions-pane.ts` (modify) — "Extract from image" control with loading + error states.

**Dependency wiring (the one tricky bit):** `createApp` already takes `store`. Both `provider` and `imageStore` become **additional injected parameters** — `createApp(store, provider, imageStore)`. Every existing route test calls `createApp(store)` with one argument, so adding two required parameters would break them all. To avoid a sprawling test edit while keeping production explicit, the two new parameters are **required** and the existing route tests are updated to pass a `FakeProvider` + temp-rooted `ImageStore`. (There are only a handful of `createApp(store)` call sites in tests; Task 4 updates them.)

---

## Task 1: LLM layer scaffolding — interface, contract, fake provider

**Files:**
- Create: `packages/server/src/llm/provider.ts`
- Create: `packages/server/src/llm/extraction-contract.ts`
- Create: `packages/server/src/llm/fake-provider.ts`
- Test: `packages/server/src/llm/fake-provider.test.ts`

This task ships the provider-agnostic core: the interface, the central prompt/schema, and a fake the rest of the plan tests against. Observable: `FakeProvider` returns contract-shaped data in a test.

- [ ] **Step 1: Define the provider interface, DTOs, and error type**

Create `packages/server/src/llm/provider.ts`:
```ts
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
```

- [ ] **Step 2: Create the central extraction contract**

Create `packages/server/src/llm/extraction-contract.ts`. The prompt instructs faithful extraction of each *distinct* question into LaTeX, no solving, no commentary. The schema is the JSON Schema for `ExtractedQuestion[]`.
```ts
/**
 * The provider-agnostic "what to ask" for image question extraction. The prompt
 * and schema live here (the application layer), not in any provider, so a future
 * CLI→API swap does not duplicate or drift them. A provider may augment the prompt
 * with backend-specific framing (e.g. the concrete image path) but must not change
 * the extraction intent.
 */
export const extractionPrompt = [
  'You are extracting questions from a single photographed page of a textbook.',
  'Identify each DISTINCT question or exercise on the page.',
  'For each one, transcribe it faithfully into LaTeX/markdown as `canonicalText`.',
  'If the book shows its own numbering for a question (e.g. "2.4"), put it in `label`; otherwise omit `label`.',
  'Do NOT solve, answer, hint at, or comment on any question. Transcribe only.',
  'Preserve mathematical notation exactly using LaTeX. Do not invent questions that are not on the page.',
  'Return the questions as a JSON array matching the provided schema.',
].join('\n');

/** JSON Schema for the extraction result: an array of ExtractedQuestion. */
export const extractionSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      canonicalText: { type: 'string' },
      label: { type: 'string' },
    },
    required: ['canonicalText'],
    additionalProperties: false,
  },
} as const;
```

- [ ] **Step 3: Write the failing test for FakeProvider**

Create `packages/server/src/llm/fake-provider.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { extractionPrompt, extractionSchema } from './extraction-contract.js';
import { FakeProvider } from './fake-provider.js';
import { LlmError } from './provider.js';

const req = { imagePath: '/tmp/x.png', prompt: extractionPrompt, schema: extractionSchema };

describe('FakeProvider', () => {
  it('returns its configured questions', async () => {
    const provider = new FakeProvider([
      { canonicalText: '\\int x\\,dx', label: '2.4' },
      { canonicalText: 'Prove that 1 = 1.' },
    ]);
    const result = await provider.extractQuestionsFromImage(req);
    expect(result).toEqual([
      { canonicalText: '\\int x\\,dx', label: '2.4' },
      { canonicalText: 'Prove that 1 = 1.' },
    ]);
  });

  it('defaults to a single deterministic question', async () => {
    const provider = new FakeProvider();
    const result = await provider.extractQuestionsFromImage(req);
    expect(result).toHaveLength(1);
    expect(result[0]?.canonicalText).toBeTruthy();
  });

  it('throws when configured to fail', async () => {
    const provider = new FakeProvider();
    provider.failWith(new LlmError('boom'));
    await expect(provider.extractQuestionsFromImage(req)).rejects.toBeInstanceOf(LlmError);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run:
```bash
npx vitest run packages/server/src/llm/fake-provider.test.ts
```
Expected: FAIL — cannot resolve `./fake-provider.js`.

- [ ] **Step 5: Implement FakeProvider**

Create `packages/server/src/llm/fake-provider.ts`:
```ts
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
```

- [ ] **Step 6: Run the test to verify it passes**

Run:
```bash
npx vitest run packages/server/src/llm/fake-provider.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck and commit**

Run:
```bash
npm run typecheck
```
Expected: PASS.
```bash
git add packages/server/src/llm/provider.ts packages/server/src/llm/extraction-contract.ts packages/server/src/llm/fake-provider.ts packages/server/src/llm/fake-provider.test.ts
git commit -m "feat: add LLM provider interface, extraction contract, and fake provider"
```

---

## Task 2: Image storage

**Files:**
- Create: `packages/server/src/storage/images.ts`
- Test: `packages/server/src/storage/images.test.ts`

`ImageStore` owns `<dataDir>/images/` and lazy-creates it, mirroring `Store`/`JsonCollection` conventions. Observable: an image file is written under `images/` in a test.

- [ ] **Step 1: Write the failing test for ImageStore**

Create `packages/server/src/storage/images.test.ts`:
```ts
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImageStore } from './images.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-images-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ImageStore', () => {
  it('saves a buffer under images/ and returns a relative + absolute path', async () => {
    const store = new ImageStore(dir);
    const buf = Buffer.from('fake-png-bytes');
    const { imagePath, absolutePath } = await store.save(buf, 'png');

    // Relative path is under images/ with a uuid filename and the given extension.
    expect(imagePath).toMatch(/^images[/\\][0-9a-f-]{36}\.png$/);
    // The absolute path points at the same file and it exists on disk.
    await expect(access(absolutePath)).resolves.toBeUndefined();
    expect(await readFile(absolutePath)).toEqual(buf);
  });

  it('lazy-creates the images directory on first save', async () => {
    const store = new ImageStore(dir);
    // images/ does not exist yet.
    await expect(access(join(dir, 'images'))).rejects.toBeTruthy();
    await store.save(Buffer.from('x'), 'jpg');
    await expect(access(join(dir, 'images'))).resolves.toBeUndefined();
  });

  it('gives each saved image a distinct filename', async () => {
    const store = new ImageStore(dir);
    const a = await store.save(Buffer.from('a'), 'png');
    const b = await store.save(Buffer.from('b'), 'png');
    expect(a.imagePath).not.toEqual(b.imagePath);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run packages/server/src/storage/images.test.ts
```
Expected: FAIL — cannot resolve `./images.js`.

- [ ] **Step 3: Implement ImageStore**

Create `packages/server/src/storage/images.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Where a saved image lives, both as a portable relative path and an absolute one. */
export interface SavedImage {
  /** Relative to the data dir, e.g. `images/<uuid>.png` — stored on QuestionSource. */
  imagePath: string;
  /** Absolute path on the server machine — what a provider needs to read the file. */
  absolutePath: string;
}

/**
 * Owns `<dataDir>/images/`. Mirrors Store/JsonCollection: owns its directory and
 * lazy-creates it on first write. The relative `imagePath` is what lands in
 * QuestionSource.imagePath; the absolute path is what the provider reads.
 */
export class ImageStore {
  private readonly imagesDir: string;

  constructor(private readonly dataDir: string) {
    this.imagesDir = join(dataDir, 'images');
  }

  /** Absolute path to the images directory (used to grant the CLI read access). */
  get directory(): string {
    return this.imagesDir;
  }

  /** Write the buffer as `<uuid>.<ext>` and return its relative + absolute paths. */
  async save(buffer: Buffer, ext: string): Promise<SavedImage> {
    await mkdir(this.imagesDir, { recursive: true });
    const fileName = `${randomUUID()}.${ext}`;
    const absolutePath = join(this.imagesDir, fileName);
    await writeFile(absolutePath, buffer);
    return { imagePath: join('images', fileName), absolutePath };
  }
}
```

> Note: `imagePath` uses `join('images', fileName)`, so on Windows it is `images\<uuid>.png`. That is fine for this build (the path is opaque and stored as-is); the test regex allows either separator. If a later plan needs URL-style forward slashes for serving images over HTTP, normalize at that boundary.

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run packages/server/src/storage/images.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and commit**

Run:
```bash
npm run typecheck
```
Expected: PASS.
```bash
git add packages/server/src/storage/images.ts packages/server/src/storage/images.test.ts
git commit -m "feat: add ImageStore for page-photo storage under images/"
```

---

## Task 3: Add multer and the extract route (with FakeProvider)

**Files:**
- Modify: `packages/server/package.json` (add `multer`)
- Modify: `packages/server/src/routes/questions.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/src/routes/questions-extract.test.ts`

This wires the multipart endpoint end-to-end against `FakeProvider`. `chapterQuestionsRouter` gains the `provider` and `imageStore` dependencies and a `POST /extract` handler. Observable: `POST /extract` creates image-sourced questions (test + curl).

- [ ] **Step 1: Install multer**

Run from repo root:
```bash
npm install --workspace @qb/server multer
npm install --workspace @qb/server --save-dev @types/multer
```
Expected: `multer` under `dependencies` and `@types/multer` under `devDependencies` in `packages/server/package.json`.

- [ ] **Step 2: Write the failing test for the extract route**

Create `packages/server/src/routes/questions-extract.test.ts`. It injects a `FakeProvider` and a temp-rooted `ImageStore` so nothing shells out.
```ts
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
let imageStore: ImageStore;
let app: Awaited<ReturnType<typeof createApp>>;
let chapterId: string;

async function setup(p: FakeProvider): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), 'qb-extract-'));
  const store = await Store.open(dir);
  provider = p;
  imageStore = new ImageStore(dir);
  app = createApp(store, provider, imageStore);
  const bookId = (await request(app).post('/api/books').send({ title: 'Book' })).body.id;
  chapterId = (await request(app).post(`/api/books/${bookId}/chapters`).send({ title: 'Ch' })).body
    .id;
}

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('POST /api/chapters/:chapterId/questions/extract', () => {
  it('stores the image and creates image-sourced questions, returning 201', async () => {
    await setup(
      new FakeProvider([
        { canonicalText: '\\int x\\,dx', label: '2.4' },
        { canonicalText: 'Prove it.' },
      ]),
    );

    const res = await request(app)
      .post(`/api/chapters/${chapterId}/questions/extract`)
      .attach('image', Buffer.from('fake-png'), { filename: 'page.png', contentType: 'image/png' });

    expect(res.status).toEqual(201);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({
      chapterId,
      canonicalText: '\\int x\\,dx',
      label: '2.4',
      source: { kind: 'image' },
    });
    expect(res.body[0].source.imagePath).toMatch(/images/);

    // The image was actually written to disk.
    const files = await readdir(join(dir, 'images'));
    expect(files).toHaveLength(1);

    // The questions are persisted and listable.
    const list = await request(app).get(`/api/chapters/${chapterId}/questions`);
    expect(list.body).toHaveLength(2);
  });

  it('returns 201 with an empty array when the LLM finds no questions', async () => {
    await setup(new FakeProvider([]));
    const res = await request(app)
      .post(`/api/chapters/${chapterId}/questions/extract`)
      .attach('image', Buffer.from('fake-png'), { filename: 'page.png', contentType: 'image/png' });
    expect(res.status).toEqual(201);
    expect(res.body).toEqual([]);
  });

  it('returns 404 when the chapter does not exist', async () => {
    await setup(new FakeProvider());
    const res = await request(app)
      .post('/api/chapters/nope/questions/extract')
      .attach('image', Buffer.from('fake-png'), { filename: 'page.png', contentType: 'image/png' });
    expect(res.status).toEqual(404);
  });

  it('returns 400 when no image is uploaded', async () => {
    await setup(new FakeProvider());
    const res = await request(app).post(`/api/chapters/${chapterId}/questions/extract`).send();
    expect(res.status).toEqual(400);
  });

  it('returns 400 when the upload is not an image', async () => {
    await setup(new FakeProvider());
    const res = await request(app)
      .post(`/api/chapters/${chapterId}/questions/extract`)
      .attach('image', Buffer.from('not-an-image'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toEqual(400);
  });

  it('returns 502 when the provider fails', async () => {
    const failing = new FakeProvider();
    failing.failWith(new LlmError('cli exploded'));
    await setup(failing);
    const res = await request(app)
      .post(`/api/chapters/${chapterId}/questions/extract`)
      .attach('image', Buffer.from('fake-png'), { filename: 'page.png', contentType: 'image/png' });
    expect(res.status).toEqual(502);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:
```bash
npx vitest run packages/server/src/routes/questions-extract.test.ts
```
Expected: FAIL — `createApp` does not accept three args, and `/extract` does not exist.

- [ ] **Step 4: Extend the questions router with the extract route**

Replace the entire contents of `packages/server/src/routes/questions.ts` with the version below. `chapterQuestionsRouter` now takes `(store, provider, imageStore)`, adds a `multer` memory-storage upload, and the `POST /extract` handler. The flat `questionsRouter` is unchanged.
```ts
import { Router } from 'express';
import multer from 'multer';
import { newId, nowIso } from '../domain/ids.js';
import type { Question } from '../domain/types.js';
import { extractionPrompt, extractionSchema } from '../llm/extraction-contract.js';
import { LlmError, type LlmProvider } from '../llm/provider.js';
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

/** Nested under /api/chapters/:chapterId/questions — list, manual create, and extract-from-image. */
export function chapterQuestionsRouter(
  store: Store,
  provider: LlmProvider,
  imageStore: ImageStore,
): Router {
  const router = Router({ mergeParams: true });
  // Memory storage: we read the buffer ourselves and hand it to ImageStore.
  const upload = multer({ storage: multer.memoryStorage() });

  router.get('/', (req, res) => {
    const chapterId = (req.params as { chapterId: string }).chapterId;
    res.json(store.questions.getAll().filter((q) => q.chapterId === chapterId));
  });

  router.post('/', (req, res) => {
    const chapterId = (req.params as { chapterId: string }).chapterId;
    if (!store.chapters.getById(chapterId)) {
      res.status(404).json({ error: 'chapter not found' });
      return;
    }
    const { canonicalText, label } = req.body ?? {};
    if (typeof canonicalText !== 'string' || canonicalText.trim() === '') {
      res.status(400).json({ error: 'canonicalText is required' });
      return;
    }
    const text = canonicalText.trim();
    const question: Question = {
      id: newId(),
      chapterId,
      canonicalText: text,
      source: { kind: 'text', rawText: text },
      createdAt: nowIso(),
      ...(typeof label === 'string' && label.trim() !== '' ? { label: label.trim() } : {}),
    };
    res.status(201).json(store.questions.create(question));
  });

  router.post('/extract', upload.single('image'), async (req, res) => {
    const chapterId = (req.params as { chapterId: string }).chapterId;
    if (!store.chapters.getById(chapterId)) {
      res.status(404).json({ error: 'chapter not found' });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'an image file is required' });
      return;
    }
    const ext = imageExt(file.mimetype);
    if (!ext) {
      res.status(400).json({ error: 'upload must be an image (png, jpeg, webp, gif)' });
      return;
    }

    // Store the image first; it is retained even if extraction fails (lets the user retry).
    const { imagePath, absolutePath } = await imageStore.save(file.buffer, ext);

    let extracted;
    try {
      extracted = await provider.extractQuestionsFromImage({
        imagePath: absolutePath,
        prompt: extractionPrompt,
        schema: extractionSchema,
      });
    } catch (err) {
      if (err instanceof LlmError) {
        res.status(502).json({ error: 'extraction failed' });
        return;
      }
      throw err;
    }

    const created = extracted.map((q) =>
      store.questions.create({
        id: newId(),
        chapterId,
        canonicalText: q.canonicalText,
        source: { kind: 'image', imagePath },
        createdAt: nowIso(),
        ...(q.label && q.label.trim() !== '' ? { label: q.label.trim() } : {}),
      }),
    );
    res.status(201).json(created);
  });

  return router;
}

/** Flat /api/questions/:id — patch + delete. */
export function questionsRouter(store: Store): Router {
  const router = Router();

  router.patch('/:id', (req, res) => {
    if (!store.questions.getById(req.params.id)) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const patch: Partial<Omit<Question, 'id'>> = {};
    const { canonicalText, label } = req.body ?? {};
    if (typeof canonicalText === 'string') patch.canonicalText = canonicalText.trim();
    if (typeof label === 'string') patch.label = label.trim();
    res.json(store.questions.update(req.params.id, patch));
  });

  router.delete('/:id', (req, res) => {
    store.questions.delete(req.params.id);
    res.status(204).end();
  });

  return router;
}
```

> Note on the `source` spread: `QuestionSource` has `exactOptionalPropertyTypes` in force, so `imagePath` is only included when present — here it is always present for `kind: 'image'`, so a plain `{ kind: 'image', imagePath }` is correct. `label` is added via conditional spread, same as the manual-create path.

- [ ] **Step 5: Update `createApp` to inject the provider and image store**

In `packages/server/src/index.ts`, change `createApp`'s signature and the `chapterQuestionsRouter` mount, and wire real implementations in `main()`. Replace the file's imports + `createApp` + `main` with:
```ts
import express, { type Express } from 'express';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { ClaudeCliProvider } from './llm/claude-cli-provider.js';
import type { LlmProvider } from './llm/provider.js';
import { booksRouter } from './routes/books.js';
import { bookChaptersRouter, chaptersRouter } from './routes/chapters.js';
import { chapterQuestionsRouter, questionsRouter } from './routes/questions.js';
import { ImageStore } from './storage/images.js';
import { Store } from './storage/store.js';

const PORT = Number(process.env.PORT ?? 3001);
// Data lives in the user's home dir, not the repo, so it survives `git clean`,
// is never at risk of being committed, and is independent of the launch cwd
// (the server is a long-running service that owns its storage). Override with QB_DATA_DIR.
const DATA_DIR = process.env.QB_DATA_DIR ?? join(homedir(), '.question-bank');

/**
 * Build the Express app over its dependencies. All three are injected (not constructed
 * here) so tests can mount the app with a FakeProvider + temp-rooted ImageStore.
 */
export function createApp(store: Store, provider: LlmProvider, imageStore: ImageStore): Express {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/books', booksRouter(store));
  app.use('/api/books/:bookId/chapters', bookChaptersRouter(store));
  app.use('/api/chapters', chaptersRouter(store));
  app.use('/api/chapters/:chapterId/questions', chapterQuestionsRouter(store, provider, imageStore));
  app.use('/api/questions', questionsRouter(store));

  return app;
}

async function main(): Promise<void> {
  const store = await Store.open(DATA_DIR);
  const imageStore = new ImageStore(DATA_DIR);
  const provider = new ClaudeCliProvider(imageStore.directory);
  const app = createApp(store, provider, imageStore);
  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
    console.log(`[server] data dir: ${DATA_DIR}`);
  });
}

// Only start a real server when this module is the process entry point — not when
// a test imports createApp. fileURLToPath turns import.meta.url into a native path,
// so the comparison works identically on Windows and POSIX (no manual slash munging).
const entry = argv[1];
if (entry !== undefined && fileURLToPath(import.meta.url) === entry) {
  void main();
}
```

> `main()` references `ClaudeCliProvider`, which is implemented in Task 4. Until then this file will not typecheck. That is expected and acceptable mid-task because the broken import is internal; if you want each task green in isolation, do Step 5 with a temporary `import` of a stub, or simply complete Task 4 before running the full typecheck. The intended flow is: finish Step 4–7 of *this* task against the route test (which never imports `ClaudeCliProvider`), then do Task 4 and run the full suite. **To keep this task self-contained, create the `ClaudeCliProvider` file now as a minimal stub** (Task 4 fills in the real body):

Create `packages/server/src/llm/claude-cli-provider.ts` as a stub:
```ts
import type { ExtractedQuestion, ExtractionRequest, LlmProvider } from './provider.js';

/** Real Claude Code CLI backend — implemented in Task 4. */
export class ClaudeCliProvider implements LlmProvider {
  constructor(private readonly imagesDir: string) {}

  extractQuestionsFromImage(_req: ExtractionRequest): Promise<ExtractedQuestion[]> {
    void this.imagesDir;
    throw new Error('ClaudeCliProvider not implemented yet');
  }
}
```

- [ ] **Step 6: Update the other route tests for the new `createApp` signature**

The existing route tests call `createApp(store)`. Update each to pass a `FakeProvider` + temp-rooted `ImageStore`. In **each** of `books.test.ts`, `chapters.test.ts`, and `questions.test.ts`, add these imports:
```ts
import { FakeProvider } from '../llm/fake-provider.js';
import { ImageStore } from '../storage/images.js';
```
and change the `createApp(store)` call (in each `beforeEach`) to:
```ts
app = createApp(store, new FakeProvider(), new ImageStore(dir));
```
(The `dir` temp directory already exists in each test's `beforeEach`.)

- [ ] **Step 7: Run the extract test and the full server suite to verify they pass**

Run:
```bash
npx vitest run packages/server/src/routes/questions-extract.test.ts
```
Expected: PASS (6 tests).
```bash
npm test
```
Expected: PASS — every server test green (the updated `createApp` signature now compiles across all route tests).

- [ ] **Step 8: Manually verify with curl**

Run the dev server:
```bash
npm run dev:server
```
In a second terminal, create a book + chapter, then extract (the real CLI is NOT exercised here — `main()` wires `ClaudeCliProvider`, which currently throws, so expect a 502; this confirms the route, upload, and image storage work end-to-end). Create any small PNG at `./page.png` first.
```bash
BOOK=$(curl -s -X POST http://localhost:3001/api/books -H "content-type: application/json" -d '{"title":"Calc"}' | python -c "import sys,json;print(json.load(sys.stdin)['id'])")
CH=$(curl -s -X POST http://localhost:3001/api/books/$BOOK/chapters -H "content-type: application/json" -d '{"title":"Ch1"}' | python -c "import sys,json;print(json.load(sys.stdin)['id'])")
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/chapters/$CH/questions/extract -F "image=@page.png"
```
Expected: `502` (the stub provider throws), AND `~/.question-bank/images/` now contains the uploaded PNG (image is retained on failure). Stop the server. The real end-to-end extraction is verified in Task 4.

> On Windows PowerShell the inline `$(...)` capture differs; either run the curl block under Git Bash, or capture the ids by eye from two separate `curl` calls. The point of the manual check is only to confirm the route accepts the multipart upload, stores the image, and returns 502 from the stub.

- [ ] **Step 9: Typecheck and commit**

Run:
```bash
npm run typecheck
```
Expected: PASS.
```bash
git add packages/server/package.json package-lock.json packages/server/src/routes/questions.ts packages/server/src/routes/questions-extract.test.ts packages/server/src/index.ts packages/server/src/llm/claude-cli-provider.ts packages/server/src/routes/books.test.ts packages/server/src/routes/chapters.test.ts packages/server/src/routes/questions.test.ts
git commit -m "feat: add image-extract endpoint with multer and DI for provider/image store"
```

---

## Task 4: Claude CLI provider (real backend)

**Files:**
- Modify: `packages/server/src/llm/claude-cli-provider.ts` (replace the stub)
- Test: `packages/server/src/llm/claude-cli-provider.test.ts`

The real provider `execFile`s `claude -p --output-format json --json-schema <schemaPath> --add-dir <imagesDir> "<prompt+image framing>"`, parses the JSON envelope, validates the structured result, and returns `ExtractedQuestion[]`. Tests exercise **only the parsing/validation** against a captured envelope fixture — no real shell-out (that needs auth/network and is left to manual verification). Observable: a captured envelope fixture parses into `ExtractedQuestion[]`; a malformed one throws `LlmError`.

To make parsing testable without shelling out, the provider is split into a pure exported `parseCliEnvelope(stdout: string): ExtractedQuestion[]` function plus the `execFile` glue. The test targets `parseCliEnvelope`.

- [ ] **Step 1: Write the failing test for envelope parsing**

Create `packages/server/src/llm/claude-cli-provider.test.ts`. The `claude --output-format json` envelope wraps the model's final output in a `result` string field; our `--json-schema` run makes that `result` the JSON array text. The fixtures below capture both a valid and a malformed envelope.
```ts
import { describe, expect, it } from 'vitest';
import { parseCliEnvelope } from './claude-cli-provider.js';
import { LlmError } from './provider.js';

// A representative `claude -p --output-format json` envelope: metadata fields plus
// `result` carrying the schema-constrained JSON array as a string.
const validEnvelope = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: JSON.stringify([
    { canonicalText: '\\int x\\,dx', label: '2.4' },
    { canonicalText: 'Prove that the sum is finite.' },
  ]),
});

describe('parseCliEnvelope', () => {
  it('parses a valid envelope into ExtractedQuestion[]', () => {
    const questions = parseCliEnvelope(validEnvelope);
    expect(questions).toEqual([
      { canonicalText: '\\int x\\,dx', label: '2.4' },
      { canonicalText: 'Prove that the sum is finite.' },
    ]);
  });

  it('throws LlmError when the envelope is not JSON', () => {
    expect(() => parseCliEnvelope('not json at all')).toThrow(LlmError);
  });

  it('throws LlmError when the envelope reports an error', () => {
    const errEnvelope = JSON.stringify({ type: 'result', is_error: true, result: 'boom' });
    expect(() => parseCliEnvelope(errEnvelope)).toThrow(LlmError);
  });

  it('throws LlmError when result is not a JSON array', () => {
    const bad = JSON.stringify({ type: 'result', is_error: false, result: '{"not":"an array"}' });
    expect(() => parseCliEnvelope(bad)).toThrow(LlmError);
  });

  it('throws LlmError when an item is missing canonicalText', () => {
    const bad = JSON.stringify({
      type: 'result',
      is_error: false,
      result: JSON.stringify([{ label: 'no text here' }]),
    });
    expect(() => parseCliEnvelope(bad)).toThrow(LlmError);
  });

  it('omits label when absent rather than setting it undefined', () => {
    const env = JSON.stringify({
      type: 'result',
      is_error: false,
      result: JSON.stringify([{ canonicalText: 'q' }]),
    });
    const [q] = parseCliEnvelope(env);
    expect(q).toEqual({ canonicalText: 'q' });
    expect('label' in q!).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run packages/server/src/llm/claude-cli-provider.test.ts
```
Expected: FAIL — `parseCliEnvelope` is not exported (the file is still the Task-3 stub).

- [ ] **Step 3: Replace the stub with the real provider + exported parser**

Replace the entire contents of `packages/server/src/llm/claude-cli-provider.ts`:
```ts
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
```

> Note: the CLI flags (`-p`, `--output-format json`, `--json-schema`, `--add-dir`) were verified against `claude` v2.1.168 in the design doc. If a newer CLI changes the envelope shape (e.g. the `result`/`is_error` field names), update `parseCliEnvelope` and its fixtures together — the parser is deliberately the single place that knows the envelope format. If `--json-schema` is unavailable in the installed CLI, the fallback is to embed the schema in the prompt and validate `parseCliEnvelope`'s output the same way (the validation in `toExtractedQuestion` already guards the shape).

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run packages/server/src/llm/claude-cli-provider.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 5: Full suite + typecheck**

Run:
```bash
npm run typecheck && npm test
```
Expected: PASS — every test green, including the route tests that import the now-real `index.ts` wiring.

- [ ] **Step 6: Manual end-to-end verification with the real CLI (documented step)**

This is the only step that exercises the real backend; it needs an authenticated `claude` CLI on the machine and is not part of automated tests.
```bash
# Confirm the CLI is authenticated and supports the flags.
claude --version            # expect v2.1.168+ per the design doc
# Run the dev server (it wires ClaudeCliProvider).
npm run dev:server
```
In a browser or via curl, create a book + chapter, then `POST .../questions/extract` with a real page photo (a clear textbook page with a few exercises). Expected: a `201` with one `ExtractedQuestion` per distinct question on the page, each persisted with `source.kind = 'image'`. Confirm the image is under `~/.question-bank/images/`. If the CLI errors, the route returns `502` and the image is retained.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/llm/claude-cli-provider.ts packages/server/src/llm/claude-cli-provider.test.ts
git commit -m "feat: implement Claude CLI extraction provider with envelope parsing"
```

---

## Task 5: Client "Extract from image" control

**Files:**
- Modify: `packages/client/src/api/client.ts`
- Modify: `packages/client/src/manage/questions-pane.ts`

Add the API call and a button beside the inline add that opens an image picker, uploads, shows a loading state while the CLI runs, then refreshes. On failure, an inline error; the pane stays usable. Observable: end-to-end image upload in the browser creates questions.

- [ ] **Step 1: Add the `extractQuestionsFromImage` API call**

In `packages/client/src/api/client.ts`, add this method to the `api` object (inside the `// Questions` group, e.g. after `createQuestion`):
```ts
  extractQuestionsFromImage: (chapterId: string, file: File) => {
    const form = new FormData();
    form.append('image', file);
    return fetch(`/api/chapters/${chapterId}/questions/extract`, {
      method: 'POST',
      body: form,
    }).then((r) => json<Question[]>(r));
  },
```
> No `content-type` header is set — the browser sets the multipart boundary automatically when the body is `FormData`. `json<T>` already throws on a non-2xx response, so a 502 surfaces as a thrown error the caller catches.

- [ ] **Step 2: Add the "Extract from image" control to the questions pane**

In `packages/client/src/manage/questions-pane.ts`, extend the add row. After the existing `addRow.append(labelInput, input, addBtn);` line and before `host.appendChild(addRow);`, insert a file input (hidden), a trigger button, and an error/status line. Replace this block:
```ts
  addBtn.addEventListener('click', add);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void add();
  });
  addRow.append(labelInput, input, addBtn);
  host.appendChild(addRow);

  await refresh();
```
with:
```ts
  addBtn.addEventListener('click', add);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void add();
  });

  // Extract-from-image: a button that triggers a hidden image file picker.
  const extractBtn = document.createElement('button');
  extractBtn.textContent = 'Extract from image';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';

  const status = document.createElement('div');
  status.className = 'status';

  extractBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    status.textContent = '';
    extractBtn.disabled = true;
    addBtn.disabled = true;
    extractBtn.textContent = 'Extracting…';
    try {
      await api.extractQuestionsFromImage(chapter.id, file);
      await refresh();
    } catch {
      status.textContent = 'Extraction failed — try again.';
    } finally {
      extractBtn.disabled = false;
      addBtn.disabled = false;
      extractBtn.textContent = 'Extract from image';
      fileInput.value = ''; // allow re-selecting the same file
    }
  });

  addRow.append(labelInput, input, addBtn, extractBtn, fileInput);
  host.append(addRow, status);

  await refresh();
```

- [ ] **Step 3: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: PASS.

- [ ] **Step 4: Manual end-to-end verification in the browser**

With an authenticated `claude` CLI on the machine:
```bash
npm run dev
```
In the browser (default `http://localhost:5173`): go to the **Manage** tab → open a book → open a chapter. Click **Extract from image**, pick a clear photo of a textbook page with a few exercises. Expected: the button shows "Extracting…" for a few seconds, then the extracted questions appear in the list (raw LaTeX), each persisted. Try a non-image or trigger a CLI error → the inline "Extraction failed — try again." message shows and the pane stays usable.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/api/client.ts packages/client/src/manage/questions-pane.ts
git commit -m "feat: add Extract from image control to the Manage questions pane"
```

---

## Deferred / later-iteration candidates (not in this plan)

- `extractQuestionsFromText` (text-input modality).
- Extraction review/staging gate before commit (if image misreads prove noisy).
- Generic `complete` / `completeStructured(Message[], Schema)` interface (introduced with grading).
- Anthropic API / Bedrock / self-hosted providers behind the same `LlmProvider`.
- Image cleanup/GC for failed or orphaned extractions.
- Serving stored images over HTTP (would need forward-slash `imagePath` normalization).
- KaTeX rendering of extracted LaTeX (Step 3).

---

## Self-Review

**Spec coverage** (against `2026-06-07-llm-image-ingestion-design.md`):
- `LlmProvider` + `extractQuestionsFromImage` + DTOs → Task 1. ✅
- Central extraction contract (prompt + schema) → Task 1. ✅
- `FakeProvider` → Task 1. ✅
- `ImageStore` under `~/.question-bank/images/` (override via `QB_DATA_DIR`) → Task 2. ✅
- `POST /api/chapters/:chapterId/questions/extract` with multer, extract-and-commit, 404/400/502/201-empty → Task 3. ✅
- `createApp(store, provider, imageStore)` injection → Task 3. ✅
- `ClaudeCliProvider` (execFile, temp schema file, `--add-dir`, envelope parsing, typed `LlmError`) → Task 4. ✅
- Client `extractQuestionsFromImage` + "Extract from image" control with loading/error → Task 5. ✅
- `source.kind = 'image'`, `source.imagePath` set; `relevance`/`nextReviewDate` unset → Task 3 (no schema change). ✅
- Tests: ImageStore unit, CLI parsing unit (fixture), route tests with FakeProvider, manual real-CLI verification → Tasks 2/4/3/4. ✅
- Build order (5 observable steps) → Tasks 1–5 map 1:1. ✅

**Placeholder scan:** no TBD/TODO; every code step shows full code; the Task-3 stub for `ClaudeCliProvider` is explicit and replaced in Task 4. ✅

**Type consistency:** `ExtractedQuestion`/`ExtractionRequest`/`LlmProvider`/`LlmError` defined in Task 1 and used unchanged in Tasks 3–4. `ImageStore.save → { imagePath, absolutePath }` and `.directory` defined in Task 2, used in Task 3 (route) and Task 3-Step-5 (`main()` passes `imageStore.directory` to the provider). `createApp(store, provider, imageStore)` signature consistent across Task 3's route mount, `main()`, and all updated route tests. `api.extractQuestionsFromImage(chapterId, file)` defined in Task 5-Step-1, used in Task 5-Step-2. ✅
