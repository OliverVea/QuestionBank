# Foundation Sub-Project — LLM Image Ingestion (Manage tab, Step 2)

**Status:** Approved design (detailed).
**Date:** 2026-06-07
**Architecture reference:** [2026-06-06-question-bank-architecture.md](./2026-06-06-question-bank-architecture.md)
**Foundation reference:** [2026-06-06-foundation-registration-design.md](./2026-06-06-foundation-registration-design.md)

## Scope

Step 2 of the foundation sub-project: **bulk LLM question ingestion from a page photo.** A user, inside a chapter in the Manage tab, uploads an image of a textbook page; the server stores the image, shells out to the Claude Code CLI to extract each distinct question into LaTeX, and commits the extracted questions under the chapter. Mistakes are fixed with the existing inline edit/delete.

This is the slice that proves the **LLM layer** end-to-end — the same structured-extraction path grading will reuse later.

**In scope:**
- The `LlmProvider` interface with a single operation for this build: `extractQuestionsFromImage`.
- A Claude Code CLI provider (the documented default backend) and a fake provider for tests.
- A centrally-authored **extraction contract** (prompt + output schema) passed into the provider.
- Image storage under `~/.question-bank/images/`.
- `POST /api/chapters/:chapterId/questions/extract` (multipart image upload), extract-and-commit.
- An "Extract from image" control in the Manage questions pane.

**Out of scope (deferred):**
- **Text input** for extraction (a separate `extractQuestionsFromText`, future).
- **A review/staging gate** — this build is extract-and-commit per the foundation spec; a gate is a captured deferred candidate "if extraction proves noisy."
- The generic `complete` / `completeStructured(Message[], Schema)` interface from the architecture doc (see Deliberate departures).
- KaTeX rendering (Step 3 — questions still show raw LaTeX source).
- Backups (`BackupStore`) — still deferred.

## Decisions (from brainstorming)

- **Backend:** Claude Code CLI, as documented in the architecture doc — `claude -p --output-format json --json-schema <schema> --add-dir <imagesDir> "<prompt>"`. Uses the user's subscription server-side, no per-client auth. The server machine must have an authenticated `claude` CLI (verified: v2.1.168 supports `-p`, `--output-format json`, `--json-schema`, `--add-dir`).
- **Modality:** image only.
- **Commit model:** extract-and-commit, no review gate.
- **Interface shape:** narrow `extractQuestionsFromImage` now; generalize to `completeStructured` when grading needs multi-turn.
- **Upload handling:** `multer` (memory storage) — the one new server dependency.
- **Prompt + schema ownership:** authored centrally in the application layer and passed into the provider as an **extraction contract**. The provider may take, adapt, or augment the prompt for its backend, and maps the schema to its backend's structured-output mechanism. This keeps *what to ask* with the application and *how to call the backend* with the provider, so a future CLI→API swap doesn't duplicate or drift the prompt/schema.

## Deliberate departures from referenced specs

- **Narrow interface vs. architecture's generic LLM layer.** The architecture doc describes `complete(Message[])` / `completeStructured(Message[], Schema)`. That surface is shaped for the multi-turn grading flow; ingestion is a single structured call. This build ships a task-specific `extractQuestionsFromImage` instead. The generic surface is introduced when grading needs it; the provider abstraction is kept thin so that generalization is additive, not a rewrite.
- Everything else follows the foundation spec (extract-and-commit, raw LaTeX, image artifacts under `~/.question-bank/images/`).

## Architecture

```
Manage questions pane
  │  (multipart: one image)
  ▼
POST /api/chapters/:chapterId/questions/extract
  │
  ├─ ImageStore.save(buffer, ext)         → ~/.question-bank/images/<uuid>.<ext>, returns relative path
  │
  ├─ build ExtractionRequest { imagePath, prompt, schema }   ← prompt + schema from llm/extraction-contract.ts (central)
  │
  ├─ provider.extractQuestionsFromImage(req) → ExtractedQuestion[]
  │       (ClaudeCliProvider in prod; FakeProvider in tests)
  │
  └─ for each → store.questions.create({ ..., source: { kind: 'image', imagePath } })
          → 201 with created questions
```

### LLM layer (`packages/server/src/llm/`)

- **`provider.ts`** — the interface and its DTOs:

  ```ts
  interface ExtractedQuestion {
    canonicalText: string;   // LaTeX/markdown — source of truth
    label?: string;          // book's own numbering, e.g. "2.4", if present
  }

  interface ExtractionRequest {
    imagePath: string;       // absolute path to the stored image
    prompt: string;          // authored centrally, passed in
    schema: object;          // JSON Schema for ExtractedQuestion[], passed in
  }

  interface LlmProvider {
    extractQuestionsFromImage(req: ExtractionRequest): Promise<ExtractedQuestion[]>;
  }
  ```

- **`extraction-contract.ts`** — the central, provider-agnostic **prompt** and **schema**. The prompt instructs faithful extraction of each *distinct* question into LaTeX `canonicalText` + optional `label`, with no solving and no commentary. The schema is the JSON Schema for `ExtractedQuestion[]`. This is the domain "what to ask"; it lives here, not in any provider.

- **`claude-cli-provider.ts`** — `ClaudeCliProvider implements LlmProvider`. Uses `node:child_process` `execFile` (no shell, args as array) to invoke `claude -p --output-format json --json-schema <schemaPath> --add-dir <imagesDir> "<prompt + image-path framing>"`. It may augment the passed-in prompt with the concrete image path so the CLI's `read` tool loads the image. Writes the schema to a temp file for `--json-schema`. Parses the CLI's JSON envelope, extracts the structured result, validates it against the expected shape, and returns `ExtractedQuestion[]`. Surfaces a typed error on non-zero exit, malformed JSON, or schema-invalid output.

- **`fake-provider.ts`** — `FakeProvider implements LlmProvider`. Returns a deterministic, configurable `ExtractedQuestion[]` (and can be set to throw) so route/service tests never shell out, hit the network, or require an authenticated CLI.

### Image storage (`packages/server/src/storage/images.ts`)

- **`ImageStore`** — owns `~/.question-bank/images/` (override via the existing `QB_DATA_DIR`). `save(buffer, ext): Promise<{ imagePath, absolutePath }>` writes `<uuid>.<ext>` (uuid via `crypto.randomUUID()`), creating the directory on first write. Mirrors `Store`'s conventions (owns its directory, lazy-create). The relative `imagePath` is what lands in `QuestionSource.imagePath`; the absolute path is what the provider needs.

### Server / API (`routes/questions.ts`, extended)

- New route on the existing `chapterQuestionsRouter`: `POST /extract`, with `multer` memory-storage middleware accepting one image field.
- Flow: 404 if chapter missing → 400 if no/invalid image (missing field, non-image mimetype) → `ImageStore.save` → build `ExtractionRequest` from the central contract → `provider.extractQuestionsFromImage` → `store.questions.create` per result with `source: { kind: 'image', imagePath }` → 201 with the created questions.
- **502** on provider failure (CLI non-zero exit, malformed/invalid output) so the client can show "extraction failed — try again." The stored image is retained (harmless; lets the user retry or inspect).
- **Wiring:** `createApp(store)` becomes `createApp(store, provider, imageStore)`. All three are **injected** (not constructed inside `createApp`) for test isolation: `main()` injects `ClaudeCliProvider` + a real `ImageStore` rooted at the data dir; tests inject `FakeProvider` + an `ImageStore` rooted at a temp dir.

### Client (`packages/client/`)

- **`api/client.ts`** — add `extractQuestionsFromImage(chapterId, file): Promise<QuestionDto[]>` posting `FormData` with the image; returns the created questions.
- **`manage/questions-pane.ts`** — an "Extract from image" button beside the existing inline add. Opens a file picker (`accept="image/*"`); on select, posts the image, shows a disabled/loading state while the CLI runs (extraction takes seconds), then appends the returned questions to the list using the existing render path. On failure, an inline error message; the pane stays usable.

## Data model

No schema changes. Extracted questions populate the existing `Question` + `QuestionSource`:
- `source.kind = 'image'`, `source.imagePath = <relative path under images/>`.
- `canonicalText` = extracted LaTeX; `label` set when the LLM found the book's numbering.
- `relevance` / `nextReviewDate` remain unset (later sub-projects).

## API (REST)

```
POST /api/chapters/:chapterId/questions/extract
  Content-Type: multipart/form-data, one image field
  → 201 [Question, ...]    questions created under the chapter
  → 404                    chapter not found
  → 400                    missing / non-image upload
  → 502                    extraction failed (CLI error / bad output)
```

This realizes the endpoint already sketched in the foundation spec's API section.

## Error handling

| Condition                         | Status | Client behavior                          |
| --------------------------------- | ------ | ---------------------------------------- |
| Chapter missing                   | 404    | (shouldn't happen from the UI)           |
| No / non-image upload             | 400    | Inline "please choose an image"          |
| CLI non-zero exit / bad JSON      | 502    | Inline "extraction failed — try again"   |
| LLM returns zero questions        | 201 [] | "No questions found in the image"        |

The provider raises a typed `LlmError`; the route maps it to 502. Image is retained on failure.

## Testing

- **Unit — `ImageStore`:** saves a buffer, returns a relative path under `images/`, file exists on disk (temp `QB_DATA_DIR`).
- **Unit — `ClaudeCliProvider` parsing:** feed a captured `claude --output-format json` envelope fixture (containing a structured result) and assert it parses into `ExtractedQuestion[]`; feed a malformed/invalid envelope and assert it throws `LlmError`. No real shell-out.
- **Route — extract endpoint with `FakeProvider`:** asserts image stored, questions created with `kind: 'image'` + `imagePath`, returned 201 payload; 404 (missing chapter), 400 (no image), 502 (provider throws).
- **Manual verification (documented step):** with an authenticated `claude` CLI on the machine, run the dev server, upload a real page photo in the Manage tab, confirm questions appear. The real CLI is not exercised in automated tests (needs auth/network).

## Build order (within this step)

Each step ends with something observable.

1. **LLM layer scaffolding** — `provider.ts`, `extraction-contract.ts`, `fake-provider.ts` (+ unit shape tests). Observable: `FakeProvider` returns contract-shaped data in a test.
2. **Image storage** — `ImageStore` (+ unit test). Observable: image file written under `images/` in a test.
3. **Extract route with FakeProvider** — multipart endpoint, `createApp(store, provider)` wiring, route tests. Observable: `POST /extract` creates image-sourced questions (test + curl).
4. **Claude CLI provider** — real backend, parsing test against a fixture. Observable: manual upload extracts real questions.
5. **Client control** — "Extract from image" in the questions pane. Observable: end-to-end image upload in the browser creates questions.

## Deferred / later-iteration candidates

- `extractQuestionsFromText` (text-input modality).
- Extraction review/staging gate before commit (if image misreads prove noisy).
- Generic `complete` / `completeStructured(Message[], Schema)` interface (introduced with grading).
- Anthropic API / Bedrock / self-hosted providers behind the same `LlmProvider`.
- Image cleanup/GC for failed or orphaned extractions.
- Extraction modal with spinner + true full-stack cancel (client abort → server detects disconnect → aborts the Anthropic request → commits nothing), replacing the current disable-buttons + status-line UX. Designed in [2026-06-07-extraction-modal-cancel-design.md](./2026-06-07-extraction-modal-cancel-design.md) — **post-v0**.
