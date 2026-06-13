# Multi-Page Extraction, Path Labels & Derived Section Tree — Design

**Status:** Approved design (detailed).
**Date:** 2026-06-13
**Supersedes the single-image flow in:** [2026-06-07-llm-image-ingestion-design.md](./2026-06-07-llm-image-ingestion-design.md)
**Data model reference:** flat problems model — `Book.questionIds[]`, `Question` (`packages/server/src/domain/types.ts`)

## Problem

Today's extraction (`POST /api/extract`, `ScanProblemsPage`) is a **single-page, book-blind, add-only transcriber**:

- One image per request (`upload.single('image')`, client sends `files[0]` only).
- The LLM sees nothing about the book — not the existing problems, not their labels.
- Every result is mapped to `kind: 'add'`; the UI's `'edit'` delta is dead code.

Three concrete failures follow:

1. **No multi-page batch.** A user photographing five pages of exercises must scan one at a time.
2. **Context-blind labels.** Page 1 shows enough to derive `1.A.3`; page 2 shows only "problem 4", so the system emits a bare, wrong label. It should recognize the missing chapter/section prefix and **ask** rather than guess.
3. **Re-scan duplicates.** Re-scanning a page already in the book silently appends duplicates; nothing recognizes "this is already problem 1.A.3."

## Goals

- Upload **multiple page images** in one extraction batch.
- Labels are **dotted paths** (`1.A.3`) from which the **section tree is derived** by splitting on `.` — no stored `Section` entity.
- **Stable identity:** problems keep their internal UUID (attempts/grading history ride on it); the path is a separate, editable, **non-unique** grouping field. Multiple problems may share a path, ordered by creation time within it.
- **Ambiguity → ask, never guess:** a page that lacks the context to build a full path comes back flagged; the user supplies the missing prefix before commit.
- **LLM-driven dedupe/repair:** the model sees the book's existing problems and decides, per extracted problem, to **add**, **edit** (improve a transcription of an existing one), or **skip** (already present, unchanged).

## Non-goals (deferred)

- A stored `Section` entity, drag-and-drop reordering of the tree, or chapter renumbering. The tree is a pure projection of labels; restructuring is editing labels.
- Token-scoping the existing-problem context (see Scaling note). v0 sends all existing problems.
- Replacing the flat `questionIds[]` ordering. It stays canonical for membership and order.
- Cross-book or cross-batch identity. Paths are book-scoped.

## Key decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Pages per batch | Up to **5** in v0 (one LLM call sees all pages so it carries section context forward). Raising the cap is a deferred follow-up. |
| Section model | Arbitrary-depth tree, **derived** from dotted-path labels (split on `.`). |
| Tree vs flat | Label encodes the path; tree is reconstructed on demand. Flat `questionIds[]` stays canonical. |
| Label semantics | Internal UUID = identity. Path = editable, **non-unique** grouping field; same-path problems order by `createdAt`. |
| Ambiguous page | **Always ask.** Model returns unresolved pages flagged; user supplies the prefix. |
| Existing-problem context | The model sees **all** existing problems (path + text + UUID) and emits add/edit/skip. |
| Existing-problem scope | **All** of them, v0. Prompt caching makes the repeated book context cheap; scope it later if a large book proves it. |
| Provider interface | **No change.** `completeStructured(Message[], schema)` already takes multiple images and an arbitrary schema. |

## Architecture

```
ScanProblemsPage  (multi-image picker + ambiguity prompts + delta review)
  │  multipart: images[] (1..5)
  ▼
POST /api/extract            ← server fetches the book's existing problems by bookId
  │
  ├─ build existingProblems = [{ id, path, canonicalText }, …]   (all problems in the book)
  ├─ build one user Message { text: extractionPrompt + existing-problems block, images: pageImages }
  ├─ provider.completeStructured(messages, extractionEnvelopeSchema)
  │
  └─ response: {
        resolved:     [ Delta, … ],          // typed add | edit | skip, each with a full path
        needsSection: [ { pageIndex, problems:[{ localLabel, canonicalText }] }, … ]
     }
        │
        ▼
client renders resolved deltas (add/edit cards; skips shown muted/collapsed)
client, for each needsSection page → asks the user for the section prefix
        │
        ▼
POST /api/extract/refine     ← same images + prior result + user's section answers / notes
        │
        ▼
"Add to book": client commits accepted add/edit deltas via existing problem CRUD.
```

The endpoint stays **stateless** apart from reading the book's current problems: nothing about the extraction is persisted until the user commits via the existing problem-create / problem-update routes. (The route does need the `bookId` now, to load existing problems — see API.)

## Extraction contract (`packages/server/src/llm/extraction-contract.ts`)

The contract is where nearly all the change lands. The provider is untouched.

### Prompt additions

The current prompt (single page, transcribe-only, always-label) is extended with:

1. **Multi-page framing.** "You are given one or more photographed pages of a single book, in reading order. Carry section context forward: if page 1 establishes Chapter 1, Section A and page 2 shows only bare problem numbers that continue the sequence, those belong to `1.A`."
2. **Path-label rule.** "Express every label as a dotted path reflecting the book's structure: `<chapter>.<section>.<problem>`, using whatever levels the book exposes (`1.A.3`, `2.4`, `II.3`, or a single segment like `Warm-ups` when the book is unstructured). Split-on-`.` must reconstruct the grouping the reader sees."
3. **Ambiguity rule.** "If a page does not give you enough context to build a full path — bare numbers with no derivable chapter/section and no prior page to continue — DO NOT invent a prefix. Return those problems under `needsSection` for that page, with their local labels, so the user can supply the section."
4. **Existing-problems / dedupe rule.** "Below is every problem already in this book as `{ id, path, text }`. For each problem you extract: if it already exists with equivalent text, return a `skip` referencing its `id`. If it exists but your transcription corrects an error (OCR, math, typo), return an `edit` referencing its `id` with the improved `canonicalText`. Otherwise return an `add`. Treat same-path-but-genuinely-different problems as `add`s (a path may hold several problems)."

The existing-problems block is rendered into the prompt text (compact `id | path | text` lines). All problems for the book, v0.

### Output schema (`extractionEnvelopeSchema`)

```jsonc
{
  "type": "object",
  "required": ["resolved", "needsSection"],
  "additionalProperties": false,
  "properties": {
    "resolved": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["kind", "canonicalText"],
        "additionalProperties": false,
        "properties": {
          "kind":          { "enum": ["add", "edit", "skip"] },
          "path":          { "type": "string" },   // required for add/edit; the derived dotted label
          "canonicalText": { "type": "string" },   // the (possibly corrected) transcription
          "targetId":      { "type": "string" }     // required for edit/skip: the existing problem's UUID
        }
      }
    },
    "needsSection": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["pageIndex", "problems"],
        "additionalProperties": false,
        "properties": {
          "pageIndex": { "type": "integer" },       // 0-based index into the uploaded images
          "problems": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["localLabel", "canonicalText"],
              "additionalProperties": false,
              "properties": {
                "localLabel":    { "type": "string" },  // what the page shows, e.g. "4" or "(b)"
                "canonicalText": { "type": "string" }
              }
            }
          }
        }
      }
    }
  }
}
```

Server-side validation (in `extract.ts`, replacing `parseExtractionResult`) enforces the cross-field rules the schema can't: `add` ⇒ has `path`, no `targetId`; `edit` ⇒ has `path` + `targetId`; `skip` ⇒ has `targetId`; every `targetId` references a real existing problem in the book; `pageIndex` is in range. A violation raises `LlmError` → 502.

## Server / API (`packages/server/src/routes/extract.ts`)

`upload.single('image')` → `upload.array('images', 5)` (v0 cap = 5, with the existing 10 MB-per-file limit). Both routes change. A 5-image cap keeps every page under the API's 8000×8000-px dimension ceiling (the >20-images-per-request rule that drops it to 2000×2000 never applies) and the whole request comfortably under the 32 MB request-size limit, so v0 can send images inline as base64 with no Files-API staging. Reject a 6th image with 400. (First-party API ceilings are far higher — 600 images/request on a 1M-context model like `claude-sonnet-4-6`, ~1.5K visual tokens per full-page photo — so 5 is a product choice, not a platform limit; see Deferred.)

```
POST /api/extract
  multipart/form-data:
    images[]   1..5 image files (png/jpeg/webp/gif)
    bookId     the book being scanned into        ← NEW: needed to load existing problems
  → 200 { resolved: Delta[], needsSection: NeedsSection[] }
  → 400  no images / invalid mimetype / missing bookId
  → 404  book not found
  → 502  extraction failed (provider error or schema/cross-field invalid)

POST /api/extract/refine
  multipart/form-data:
    images[]            the same image set
    bookId
    currentExtraction   JSON of the prior { resolved, needsSection }
    sectionAnswers      JSON: { [pageIndex]: "<path prefix the user chose>" }   ← resolves needsSection
    note                optional free-text correction (as today)
  → 200 { resolved, needsSection }   // needsSection should now be empty if all answered
```

`refine` rebuilds the conversation as today (user prompt+images → assistant's prior JSON → user's correction), but the correction turn now states the per-page section prefixes the user supplied and any free-text note, instructing the model to fold the `needsSection` problems into `resolved` under those prefixes.

The route loads existing problems via the injected store (`store.questions` filtered by `bookId`), so `extractRouter(provider)` becomes `extractRouter(provider, store)`.

## Client (`packages/client/src/pages/ScanProblemsPage.ts`)

The chat-style page already models add/edit/skip-shaped deltas; it grows three capabilities:

1. **Multi-image intake.** Accept and stash multiple files; render a photo bubble per page (or a strip). Post all as `images[]` plus `bookId` (the page already knows the book it returned from).
2. **Ambiguity prompts.** When the response has `needsSection` entries, render, per affected page, a prompt bubble: "Page 3 shows problems 1, 2 with no chapter/section — which section are these in?" with a text/quick-pick input. Collect answers into `sectionAnswers` and call `/refine`. The "Add to book" button stays disabled while any page is unresolved.
3. **Typed deltas.** Map `resolved` straight through: `add` → new card, `edit` → before/after card (before = the existing problem's text, looked up by `targetId`), `skip` → muted/collapsed "already in book" row (not committable, shown for transparency). Wire the `'edit'` rendering that already exists.

**Commit:** "Add to book" applies accepted deltas through the existing problem CRUD — `add` creates a problem (`label = path`, `source.kind = 'image'`), `edit` updates the `canonicalText` of `targetId`. `skip` commits nothing.

## Section tree (derived, client-side)

No storage, no entity. A pure function over the book's problems:

```
buildTree(problems) :
  for each problem, split its label/path on "." → segments
  insert into a tree keyed by segment; leaves carry the problem (UUID)
  problems sharing a full path collect at one leaf, ordered by createdAt
  a problem whose label has no "." is a single-segment (top-level) node
```

Used by: a tree view in book management, and "learn this chapter/section" — any tree node yields the flat list of problem UUIDs beneath it, which feeds the existing practice/learn flow. Editing a problem's path label moves it in the tree on the next render; nothing migrates.

## Data model

**No schema change.** `Question.label` already holds an editable string defaulting to the index; it now conventionally holds the dotted path. `Book.questionIds[]` stays canonical for membership/order; the tree is derived. `source.kind = 'image'` as today (multi-page batches still record image provenance; which specific page is not tracked — deferred).

## Error handling

| Condition | Status | Client behavior |
| --- | --- | --- |
| No images / bad mimetype / missing bookId | 400 | Inline "choose at least one page image" |
| More than 5 images | 400 | Inline "up to 5 pages per scan" (the client should also block selecting a 6th) |
| Book not found | 404 | (shouldn't happen from UI) |
| Provider error / schema / cross-field invalid | 502 | "Extraction failed — try again" |
| `needsSection` non-empty | 200 | Per-page section prompt; commit blocked until resolved |
| All `skip` (re-scan of known pages) | 200 | "These problems are already in the book" |

## Testing

Per the project's high-level test preference (integration/e2e over granular units):

- **Route — `/extract` with `FakeProvider`:** multi-image upload + `bookId`; existing problems are passed into the provider's received messages; response splits into resolved/needsSection; cross-field validation rejects an `edit` with no `targetId` (502); 400 on no images / missing bookId; 404 on unknown book.
- **Route — `/refine`:** `sectionAnswers` for a page move its problems into `resolved`; transcript shape (user→assistant→user) correct.
- **Contract — `buildTree`:** flat problems with paths `1.A.1, 1.A.2, 1.B.1, 2.1, Warm-ups` reconstruct the expected tree; two problems sharing `1.A.3` collect at one leaf ordered by `createdAt`.
- **Dedupe behavior (with `FakeProvider`):** provider configured to return `skip` for an existing `targetId` and `add` for a new one ⇒ commit creates only the new problem.
- **Manual / e2e:** real multi-page photo batch in the browser → resolved + an ambiguity prompt → answer → commit; re-scan the same pages → all skips.

## Build order

Each step ends with something observable.

1. **Contract + validation** — extend `extraction-contract.ts` (prompt, envelope schema), replace `parseExtractionResult` with the typed-delta validator. Observable: unit test parses a resolved/needsSection envelope; rejects invalid cross-field deltas.
2. **`buildTree`** — derive-tree function + test. Observable: tree reconstructed from flat paths in a test.
3. **`/extract` multi-image + existing-problems context** — `upload.array('images', 5)`, `bookId`, load existing problems, `extractRouter(provider, store)` wiring, route tests with `FakeProvider` (including the 6th-image → 400 case). Observable: multi-image POST returns typed deltas; skip/add behavior verified.
4. **`/refine` with `sectionAnswers`** — resolve `needsSection`, route test. Observable: answered page moves into resolved.
5. **Client multi-image + ambiguity prompts + typed deltas** — `ScanProblemsPage` intake, prompt bubbles, edit/skip rendering, commit via existing CRUD. Observable: end-to-end multi-page scan with an ambiguity prompt and a re-scan-all-skips run.
6. **Section tree view + learn-by-node** — render the derived tree; "learn this section" feeds node's UUIDs into the practice flow. Observable: pick a chapter, practice only its problems.

## Deferred candidates

- **Raise the 5-page cap + eager Files-API upload.** The 5-image v0 cap is a product choice, not a platform limit (the first-party API allows 600 images/request on a 1M-context model). Raising it pairs naturally with eager uploading: start streaming each selected photo to the server — and on to Anthropic's **Files API** (beta `files-api-2025-04-14`) — the moment it's picked, so "extract" sends lightweight `file_id` references instead of inline base64. That sidesteps the 32 MB request-size limit (the real ceiling once images get large or numerous) and overlaps upload latency with user think-time. Three preconditions before building it: (1) the `LlmProvider` interface gains an upload operation and `ImageRef` gains a remote-`file_id` variant — today the client never talks to Anthropic, so eager upload goes client → server → Files API; (2) **orphan-file GC becomes required** — uploaded files persist until deleted, and a user who picks photos then bails would leak them (this turns the already-deferred "image cleanup/GC" item into a hard requirement); (3) there must be an actual overlap window to hide the latency in — extraction currently auto-starts on page load (`ScanProblemsPage.ts`), so the upload would need to kick off at selection time on the prior page, or a confirm step inserted. Until then: inline base64, ≤5 pages, no Files-API statefulness.
- **Image-page provenance.** `source.kind = 'image'` is recorded, but which of the batch's pages a problem came from is not tracked.

## Scaling note (deferred, not silently capped)

v0 sends **all** existing problems to the model each scan. For a large book this grows the prompt; prompt caching keeps the repeated book context cheap, but there is a context ceiling. Deferred candidate: scope the context to problems under the pages' apparent paths (a cheap first pass reads page headers, then we pass only the relevant subtree). Flagged here so the limit is explicit rather than discovered.
