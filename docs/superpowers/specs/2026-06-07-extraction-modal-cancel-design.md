# Extraction Modal — Spinner + True Cancel (Manage tab)

**Status:** Deferred — post-v0. Designed, not scheduled. The full-stack-abort
mechanism below is worked out so implementation can start from this doc when the
work is picked up; revisit for staleness at that point.
**Date:** 2026-06-07
**Architecture reference:** [2026-06-06-question-bank-architecture.md](./2026-06-06-question-bank-architecture.md)
**Builds on:** [2026-06-07-llm-image-ingestion-design.md](./2026-06-07-llm-image-ingestion-design.md)

## Scope

Replace the current image-extraction UX — disabled buttons plus a one-line status message — with a **modal that owns the API-call lifecycle**: it shows a spinner while extraction runs and lets the user **cancel the in-flight request**. Cancel is a *true, full-stack cancel*: the client aborts the upload, the server detects the dropped connection, aborts the Anthropic request, and commits **no** questions.

This sharpens the slice shipped in the LLM-image-ingestion build. Extraction takes seconds against the live API; the user needs visible progress and a way out of a long or mistaken upload without leaving orphaned questions behind.

**In scope:**

- A hand-rolled modal (vanilla DOM) for the extraction lifecycle: idle entry → extracting (spinner + Cancel) → success (auto-close + refresh) → error (Retry + Close).
- Client `AbortController` wiring through `api.extractQuestionsFromImage(chapterId, file, signal?)` into `fetch`.
- Server-side abort: `POST /extract` detects client disconnect via `req.on('close')` and aborts the provider call; **no commits** happen if aborted.
- An optional `signal?: AbortSignal` on `ExtractionRequest`, forwarded by `AnthropicApiProvider` into `messages.create(params, { signal })`.
- `FakeProvider` grows abort-awareness so the cancel path is testable without the network.

**Out of scope (deferred):**

- A review/staging gate before commit (still per foundation: extract-and-commit).
- Image GC for cancelled/failed extractions (no GC exists today; cancel leaves the saved image, matching the failure-retention behavior — see Open questions).
- Progress *percentage* or streaming token counts — the spinner is indeterminate (the API call is a single non-streamed request).
- Multi-image / batch upload.
- Any change to the extraction contract (prompt/schema) or the model.

## Decisions (baked in from this session)

1. **Cancel is a true cancel, full-stack.** Client aborts `fetch` via `AbortController` → the server route's `req.on('close')` fires → an `AbortController` on the server aborts the provider's `messages.create`. Because commits happen *after* the provider returns, an aborted call short-circuits before any `store.questions.create`. Not a client-only abort that lets the server finish and commit anyway.
2. **On success:** the modal auto-closes and the questions list refreshes (existing `refresh()`).
3. **On failure (502 / network error):** the modal stays open and shows the error with two actions — **Retry** (re-runs the *same* image) and **Close**.
4. **Framework-free:** the modal is hand-rolled DOM matching `questions-pane.ts` style. No React/Vue, no CSS framework.

## Lifecycle (state machine)

The modal is opened the moment a file is chosen (via "Take photo" or "Choose image"); it owns the request from there.

```
        file chosen
            │
            ▼
      ┌───────────┐  cancel clicked / fetch rejects with AbortError
      │ EXTRACTING│──────────────► (modal closes, nothing committed)
      │ spinner + │
      │  Cancel   │
      └─────┬─────┘
            │
   ┌────────┴─────────┐
   ▼                  ▼
success             failure (502 / network)
modal auto-closes   ┌──────────────┐
+ list refresh      │  ERROR        │
                    │ message +     │
                    │ Retry  Close  │
                    └───┬────────┬──┘
                        │Retry   │Close
                        ▼        ▼
                    EXTRACTING  (modal closes)
                    (same file)
```

States:

- **EXTRACTING** — spinner + "Extracting…" + **Cancel** button. Entered on open and on Retry. Backdrop click and Escape are treated as Cancel.
- **ERROR** — error text + **Retry** + **Close**. The chosen `File` is retained in closure so Retry re-posts the identical image.
- **(closed)** — modal removed from the DOM; controls in the pane re-enabled. Reached by success (auto), Cancel, or Close.

Cancel during EXTRACTING: abort the controller, close the modal immediately (don't wait for the server). The dropped connection drives server-side cleanup; the client doesn't need the server's acknowledgement to return to a usable state.

## Client design (`packages/client/`)

### `api/client.ts`

Add an optional `signal` parameter, forwarded to `fetch`:

```ts
extractQuestionsFromImage: (chapterId: string, file: File, signal?: AbortSignal) => {
  const form = new FormData();
  form.append('image', file);
  return fetch(`/api/chapters/${chapterId}/questions/extract`, {
    method: 'POST',
    body: form,
    ...(signal ? { signal } : {}),
  }).then((r) => json<Question[]>(r));
},
```

The conditional spread avoids passing `signal: undefined` (consistent with the codebase's `exactOptionalPropertyTypes` discipline, though `fetch`'s lib type already permits `undefined` — the spread keeps the call uniform with the server-side request type).

When the controller aborts, `fetch` rejects with a `DOMException` named `AbortError`. The modal distinguishes this from real failures: AbortError → silent close (we initiated it); anything else → ERROR state.

### `manage/questions-pane.ts`

Replace `runExtract` and the `status` line with modal-driven flow:

- Remove the `status` div and the in-place "Extracting…" button-text mutation. The buttons still disable while the modal is open (prevents a second concurrent upload), and re-enable when it closes.
- A new `openExtractionModal(file)` builds the modal element, appends it to `host` (or `document.body`), and runs the state machine. It creates a fresh `AbortController` per attempt.
- The modal owns: spinner element, Cancel/Retry/Close buttons, error text, the current `AbortController`, and the retained `File`.
- On success: `await refresh()`, then remove the modal. On AbortError: just remove the modal. On other error: switch to ERROR state.
- Both pickers (`cameraInput`, `fileInput`) call `openExtractionModal(file)` instead of `runExtract`. Picker `.value` is still reset so the same file can be re-selected after the modal closes.

DOM/markup sketch (matching existing class-based styling, plus a small amount of new CSS):

```
<div class="modal-backdrop">          ← click = cancel (during EXTRACTING) / close (during ERROR)
  <div class="modal">
    <div class="spinner"></div>       ← CSS keyframe spin; hidden in ERROR state
    <p class="modal-msg">Extracting…</p>
    <div class="modal-actions">
      <button>Cancel</button>         ← EXTRACTING
      <!-- or -->
      <button>Retry</button><button>Close</button>  ← ERROR
    </div>
  </div>
</div>
```

A spinner needs a few lines of CSS (a bordered circle + `@keyframes spin`). Where the project's global stylesheet lives will be confirmed at implementation time; the modal/backdrop/spinner classes go alongside the existing `.list` / `.row` / `.status` rules.

## Server design (`packages/server/`)

### `routes/questions.ts` — `POST /extract`

Wire client-disconnect to provider abort:

```ts
const ac = new AbortController();
// `close` also fires on normal completion; gate on whether we already responded.
req.on('close', () => {
  if (!res.writableEnded) ac.abort();
});

// ... save image ...

let extracted;
try {
  extracted = await provider.extractQuestionsFromImage({
    imagePath: absolutePath,
    prompt: extractionPrompt,
    schema: extractionSchema,
    ...(ac.signal ? { signal: ac.signal } : {}),   // always present here; spread keeps shape uniform
  });
} catch (err) {
  if (ac.signal.aborted) return;                   // client gone: commit nothing, send nothing
  if (err instanceof LlmError) {
    res.status(502).json({ error: 'extraction failed' });
    return;
  }
  throw err;
}

// commits happen only past this point — unreachable if aborted
```

Key points:

- **`res.writableEnded` guard** prevents the false-positive abort: `close` fires on normal completion too, but by then the response is already written, so we must not treat it as a cancel. (Order matters: register `req.on('close')` early, but the guard makes a late, post-response `close` a no-op.)
- **After an abort, send nothing.** The socket is already gone; attempting `res.status(...)` would throw "write after end" / be ignored. Return silently.
- The image is still saved before the provider call and **retained** on abort (same as failure today) — see Open questions.

### `llm/provider.ts` — `ExtractionRequest`

Add an optional signal:

```ts
export interface ExtractionRequest {
  imagePath: string;
  prompt: string;
  schema: object;
  /** Abort the in-flight backend call when the client disconnects. */
  signal?: AbortSignal;
}
```

Because `exactOptionalPropertyTypes` is on, callers must **omit** `signal` rather than pass `undefined` — hence the conditional spread in the route (and in any test caller that doesn't supply one).

### `llm/anthropic-api-provider.ts`

Forward `req.signal` into the request-options object alongside `timeout` / `maxRetries`:

```ts
message = await this.client.messages.create(
  { /* model, max_tokens, messages, output_config */ },
  { timeout: REQUEST_TIMEOUT_MS, maxRetries: 2, ...(req.signal ? { signal: req.signal } : {}) },
);
```

The SDK accepts `signal?: AbortSignal` on request options (confirmed: `@anthropic-ai/sdk@0.102.0`, `internal/request-options.d.ts:57`). On abort the SDK rejects; the route catches it and — because `ac.signal.aborted` — returns silently. (The SDK may surface the abort as its own error type rather than a raw `AbortError`; the route keys off `ac.signal.aborted`, not the error identity, so this is robust either way.)

### `llm/fake-provider.ts`

Grow abort-awareness so the cancel path is testable without the network. Make the fake resolve only after the test releases it, and reject if the signal aborts first:

- Add a "pending" mode: `extractQuestionsFromImage` returns a promise that does **not** resolve immediately, and rejects (with an abort-style error) when `req.signal` fires `abort`.
- A test then: starts the request (supertest with an abortable agent, or by exercising the route handler directly), aborts, and asserts (a) the provider promise rejected, (b) no questions were committed, (c) the response was not written.

Exact fake shape is an implementation detail; the requirement is: *the fake must honor `req.signal` so a test can drive abort deterministically.*

## API

No new endpoints, no status-code changes. The contract gains one behavior:

```
POST /api/chapters/:chapterId/questions/extract
  → 201 [Question, ...]   created (success)
  → 502                   extraction failed (provider error)
  → 400 / 404             (unchanged)
  client disconnect mid-flight → provider aborted, 0 questions created, no response body
```

## Error & cancel handling matrix

| Condition                          | Server                                   | Client / modal                         |
| ---------------------------------- | ---------------------------------------- | -------------------------------------- |
| Success                            | 201 with created questions               | Auto-close + list refresh              |
| Provider error (`LlmError`)        | 502 `{ error: 'extraction failed' }`     | ERROR state → Retry / Close            |
| Network failure (no response)      | —                                        | ERROR state → Retry / Close            |
| User cancels mid-flight            | `close` → abort provider, no commit, no body | Close modal immediately (AbortError swallowed) |
| Cancel races with completion       | `writableEnded` guard → abort is a no-op; response already sent | If response already arrived, treat as success; otherwise close |

The last row is the genuine race: the user clicks Cancel just as the server finished and is writing 201. The `writableEnded` guard makes the server side safe (it won't abort a completed call). On the client, if the `fetch` promise has already resolved when Cancel is clicked, prefer the success outcome (refresh + close); if it's still pending, abort and close. Either way no orphaned commit and no crash.

## Testing

- **Route — cancel aborts the provider and commits nothing** (`FakeProvider` in pending/abort-aware mode): start the extract request, trigger client disconnect, assert the provider promise rejected, `store.questions.getAll()` gained nothing, and no response body was sent.
- **Route — success unchanged:** existing extract-success test still passes (questions created, 201). Regression guard for the `req.on('close')` + `writableEnded` wiring not breaking the happy path.
- **Route — provider error → 502 unchanged.**
- **Provider — signal forwarded:** with an injected fake `Anthropic` client, assert `messages.create` received `{ signal }` in its options when `req.signal` is set, and that aborting the signal rejects the call. (Mirrors the existing injectable-client test.)
- **Client — `api.extractQuestionsFromImage` passes `signal` to `fetch`:** with a stubbed `fetch`, assert the `signal` is forwarded; assert it is *omitted* when not provided.
- **Manual verification:** dev stack running; in the Manage tab upload a real page photo, confirm the modal spins; click Cancel mid-extraction and confirm (a) the modal closes, (b) no new questions appear, (c) the server log shows the aborted request. Then upload again and let it complete; confirm auto-close + refresh. Force a failure (e.g. invalid key) and confirm the ERROR state with working Retry.

## Build order

Each step ends with something observable.

1. **Provider signal plumbing** — `ExtractionRequest.signal?`, forward in `AnthropicApiProvider`, provider test. Observable: provider test shows `signal` reaching `messages.create` and abort rejecting.
2. **Abort-aware `FakeProvider`** — pending/abortable mode (+ shape test). Observable: a test can start-then-abort the fake deterministically.
3. **Server abort wiring** — `req.on('close')` + `writableEnded` guard + "commit nothing on abort" in the route, route tests (cancel, success-unchanged, 502-unchanged). Observable: cancel route test green.
4. **Client `signal` param** — `api.extractQuestionsFromImage(…, signal?)` + client test. Observable: stubbed-fetch test green.
5. **Extraction modal** — hand-rolled modal + state machine in `questions-pane.ts`, replacing the status line; spinner CSS. Observable: end-to-end in the browser — spinner, working Cancel, auto-close on success, ERROR+Retry on failure.

## Open questions (resolve before/at implementation)

1. **Saved image on cancel.** Today the image is saved before extraction and retained on failure (route comment ~line 76). A cancel currently leaves it too. Keep that (consistent, no GC exists) or delete the just-saved image on abort? Proposed: **keep it** for now; orphaned-image GC is a separately-deferred concern.
2. **Spinner CSS location.** Confirm the global stylesheet path at implementation time and co-locate `.modal*` / `.spinner` rules with the existing pane styles.
3. **Modal mount point.** `host` (the pane) vs `document.body`. Proposed: `document.body` with a fixed backdrop, so the modal isn't clipped by pane layout.
