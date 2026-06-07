# Grading — Photo-first Attempts & the Learn tab (vertical slice)

**Status:** Approved design.
**Date:** 2026-06-07
**Parent:** [Question Bank — System Architecture](./2026-06-06-question-bank-architecture.md) (the "Grading" sub-project).
**Supersedes:** [Grading — Attempts & the Learn tab](./2026-06-07-grading-attempts-design.md), which made typed answers primary and deferred photo transcription. The product owner clarified that **photo scanning of the handwritten answer is the whole point**; typed answers are secondary. This spec inverts that priority and brings photo transcription into the slice.

## Goal

Let the user open a question, **photograph their handwritten working** (and/or type an answer), have the photos faithfully transcribed to LaTeX, confirm/edit that transcription, and then get LLM-assisted critique in a back-and-forth chat where **every LLM turn carries a recommended grade** (`correct` / `partial` / `incorrect`, where *partial* means ≥70% there). The user sets the final rating, committed as an **Attempt** that preserves the photos, typed text, and final transcription.

## The loop (product behavior)

1. **Suggested-next / navigator** — a suggested un-attempted question, plus a book→chapter→question browser to pick any question. Per-question **Skip** (never suggest again) and **Not now** (snooze 12h).
2. **Answer step** — attach **one or more photos** and/or **type** an answer. **At least one of the two is required.** Photo input reuses the same control as question extraction (see *Reusable image input*).
3. **Transcribe** — all attached photos go to **one** vision call → a **single combined LaTeX transcription block**. The transcriber's role is *purely transcription* (see *Transcription contract* — this is a hard constraint).
4. **Confirm/edit** — the user sees the combined transcription block **and** their typed text, both **editable**, and confirms. Editing here is also the "type from scratch / fix a bad scan" path.
5. **Grade** — the confirmed transcription **and** typed text are surfaced together to the grading call. A chat: each turn returns critique + a recommended grade; the user can reply to clarify and it re-grades. Stateless full-transcript replay (client owns the chat).
6. **Rate & save** — the user accepts or overrides the recommended grade and saves. The **Attempt** persists photos + typed text + final transcription + grade/rating/critique. The suggestion advances (the question now has an attempt).

## Scope

**In this slice**

1. General conversational `LlmProvider` (`complete` / `completeStructured` over `Message[]` with lazy `ImageRef`); existing image **question-extraction** refactored onto it.
2. **Answer photo transcription** (new central contract; transcribe-only).
3. **`Attempt`** data model + JSON storage (photos + typed + final transcription + grade/rating/critique).
4. **Skip / snooze** state on the `Question`.
5. **Grading critique chat** + **rating**, via stateless full-transcript replay.
6. **Reusable image-input component** factored out of the extraction pane and reused for answer photos (multiple files).
7. **Learn tab UI**: suggested-next card (Answer / Skip / Not now) + navigator + answer/transcribe/confirm/grade view.
8. Label-extraction improvement (folded in): make extraction always produce a referenceable `label`.

**Deferred (own specs / later)**

- SRS due-scheduler & prioritization (Practice tab).
- Answer LaTeX/KaTeX rendering of the *grading chat* turns beyond the transcription/question (chat critique stays plain text; question + transcription render with KaTeX).
- Persisting the full critique transcript (only final-state critique is stored).
- Provider/key/model configuration via UI/API.
- Live in-app camera capture beyond the existing `capture="environment"` file input.

## Data model

### New entity: `Attempt` (`data/attempts.json`)

A new `JsonCollection`/`Repository<Attempt>`, opened in `Store` alongside the others. **Final-state only** — the in-flight grading chat is not stored server-side.

```
Attempt
  id                string (uuid)
  questionId        string                                   // → Question
  imagePaths        string[]                                 // saved answer photos, relative paths under images/ (like extraction); may be empty
  answerText        string                                   // user's typed answer (plain text); may be ""
  transcription     string                                   // final confirmed/edited LaTeX from the photos; may be ""
  recommendedGrade  "correct" | "partial" | "incorrect"      // last grade the LLM gave
  rating            "correct" | "partial" | "incorrect"      // user's final decision (accept/override)
  critiqueText      string                                   // the LLM's final critique message
  createdAt         ISO timestamp
```

**Invariant (enforced at the route):** at least one of `imagePaths` (non-empty) or `answerText` (non-empty) must be present. The text surfaced to the grader = `answerText` + `transcription` combined. A question may accumulate **multiple** attempts. "Un-attempted" means **zero** attempts.

### `Question` additions (skip / snooze — mutable current state)

```
skipped        boolean?        // "Skip" = never suggest again
snoozedUntil   ISO timestamp?  // "Not now" = suggest again after this time (12h from now)
```

Both optional, consistent with existing optional `relevance` / `nextReviewDate`. Set via the existing question PATCH route (widened). Passing `snoozedUntil: null` clears a snooze.

### Shared grade type

```ts
type Grade = 'correct' | 'partial' | 'incorrect';   // partial ⇒ ≥70% there
```

Defined once server-side and mirrored in the client.

## LLM conversational interface

Generalize `LlmProvider` to the architecture spec's conversational shape; existing `extractQuestionsFromImage` is re-expressed in terms of it.

```ts
type Role = 'user' | 'assistant';

/** A reference the provider resolves to bytes only when it serializes the turn. */
interface ImageRef {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  load(): Promise<Buffer>;   // lazy
}

interface Message { role: Role; text: string; images?: ImageRef[]; }
interface CompleteOpts { model?: string; timeoutMs?: number; }

interface LlmProvider {
  complete(conversation: Message[], opts?: CompleteOpts): Promise<string>;
  completeStructured<T>(conversation: Message[], schema: object, opts?: CompleteOpts): Promise<T>;
}
```

- `ImageRef` decouples bytes from location: `fileImage(absolutePath, mimeType)` reads from disk; `bufferImage(bytes, mimeType)` returns an in-memory buffer; a future `s3Image` drops in with no provider changes. The provider never branches — it calls `load()`.
- **Stateless full-transcript replay.** The server holds no session; each grading turn the client sends the whole `Message[]` and the route replays it.
- **Extraction refactor.** Image question-extraction becomes a thin call over `completeStructured` (one user `Message` carrying a `bufferImage` + the extraction schema), passing `file.buffer` directly (no disk re-read).
- Transcription and grading both use `completeStructured` so the schema forces the output shape.

### Transcription contract (`llm/transcription-contract.ts`) — transcribe ONLY

`buildTranscriptionPrompt(questionText: string)` + schema `{ transcription: string }`. **Hard constraints** (the central reason this is its own contract):

- The agent's **only** job is to transcribe the handwritten working in the image(s) into LaTeX, **exactly as written**.
- It must **NOT** solve the problem, correct mistakes, complete unfinished steps, comment, or grade. **If the working is wrong or incomplete, transcribe it wrong/incomplete.** (Otherwise grading judges the agent's correction, not the student's work.)
- The question text is provided as **REFERENCE ONLY**, to help read unclear handwriting — explicitly *not* a thing to answer or fix toward.
- Return all working as a single `transcription` block.

All attached photos are sent in **one** user `Message` (multiple `images`), yielding one combined transcription.

### Grading contract (`llm/grading-contract.ts`)

`buildGradingPrompt({ canonicalText, chapterDescription?, bookLearningGoal? })` + schema `{ critiqueText, recommendedGrade }`. Constraints:

- Grade the user's answer to **this one titled question only**; don't solve other problems or wander.
- **React to the user's answer**; don't independently produce a full worked solution.
- Every turn returns `critiqueText` + `recommendedGrade`; `partial` = ≥70% there.
- Context: the question's `canonicalText`, the chapter `description`, the book `learningGoal` (when present).
- The graded answer is the combined typed text + confirmed transcription, supplied as the first user turn.

## Reusable image input

The Manage extraction pane already has "Take photo" (`<input type=file accept=image/* capture=environment>`) + "Choose image". Factor this into a generic component (e.g. `client/src/components/image-input.ts`) that:

- Renders Take-photo + Choose-image controls.
- Supports **multiple** selected files (answer photos) as well as the single-file extraction case.
- Calls back with the chosen `File`(s); the caller owns upload + progress UX.

The extraction pane is migrated onto this component (behavior unchanged: single file). The answer step uses it in multi-file mode.

## API

REST, resource-oriented, nested where natural — matching existing routers.

### Transcribe answer photos (stateless; nothing persisted)

```
POST /api/questions/:id/transcribe
  body:  multipart/form-data, one or more `images` fields
  reply: { transcription: string }
```

Loads the question (404 if missing), saves each image via `ImageStore` (retained for the eventual attempt), sends all images + the question text (reference-only) through `completeStructured` with the transcription contract, returns the combined transcription. Provider failure → `502 { error: 'transcription failed' }`. The saved relative image paths are returned too so the client can attach them to the eventual commit:

```
  reply: { transcription: string, imagePaths: string[] }
```

### Grade a turn (stateless; nothing persisted)

```
POST /api/questions/:id/grade
  body:  { conversation: Message[] }    // full transcript, client-owned; first user turn holds the combined answer
  reply: { critiqueText: string, recommendedGrade: Grade }
```

Loads the question (404), builds the grading context, replays `conversation` through `completeStructured`, returns the next turn. Empty conversation → `400`. Provider failure → `502 { error: 'grading failed' }`.

### Commit an attempt / history

```
POST /api/questions/:id/attempts
  body:  { imagePaths: string[], answerText, transcription, recommendedGrade, rating, critiqueText }
  reply: 201 Attempt        // 400 if neither imagePaths nor answerText present, or invalid grade
GET  /api/questions/:id/attempts
  reply: Attempt[]          // empty ⇒ un-attempted
```

### Skip / snooze (widen existing PATCH)

```
PATCH /api/questions/:id
  body: { skipped?: boolean, snoozedUntil?: string | null }   // plus existing canonicalText/label
```

`Not now` sends `snoozedUntil` = now + 12h. `Skip` sends `skipped: true`. `null` clears a snooze.

### Suggested next

```
GET /api/learn/next
  reply: { question: Question, book: Book, chapter: Chapter } | { question: null }
```

Service-layer query (plain filter over `getAll()`): questions where attempts count is `0`, `skipped !== true`, and (`snoozedUntil` unset **or** in the past), ordered by **book order → chapter.order → question createdAt**, returning the first with its book + chapter.

## Label-extraction improvement (folded in)

Update the extraction contract so the agent **always** yields a referenceable `label`: prefer a real label from any page signal (the question's own number, "Problem N"/"Exercise N", section/chapter numbers, page header/footer); **position-based fallback** (`#1`, `#2`, … or `p.<page>-<n>`) only when no real label exists. The "do not solve/answer/hint" constraint is unchanged. `label` stays optional in the type (manual creation) but extraction should not return blanks.

## Client / UI (Learn tab)

Replaces the `renderLearn` stub. Top → bottom:

1. **Suggested-next card** — `GET /api/learn/next`. Label + KaTeX-rendered question body (reuse `render/content.ts`). Buttons: **Answer**, **Skip** (PATCH `skipped:true`), **Not now** (PATCH `snoozedUntil`=+12h). Empty state when `question: null`.
2. **Navigator** — book → chapter → question drill-down (same tree data as Manage) to open any question's answer view.
3. **Answer / transcribe / confirm / grade view** (opens on Answer / pick):
   - Question (label + KaTeX body).
   - **Answer step:** reusable image input (multi-file) for photos + a plain-text `textarea`. **Transcribe & continue** is enabled when at least one photo or some typed text is present.
   - **Transcribe:** posts photos to `/transcribe`; shows progress; on success advances to confirm.
   - **Confirm/edit step:** an editable `textarea` pre-filled with the combined transcription, plus the typed-answer `textarea` (also editable). **Looks good — grade it** continues.
   - **Grading chat:** client-memory transcript (lost on reload, by design). First user turn = combined typed + confirmed transcription. Each LLM turn renders `critiqueText` + a **recommended-grade badge**. Reply box to clarify; re-grades each turn (POSTs full `conversation`).
   - **Rating control** (accept recommended or override) → **Save attempt** POSTs to `/attempts` with `imagePaths` (from `/transcribe`), `answerText`, `transcription`, grade fields → returns to the suggested-next card (which advances).

### Styling convention (standing rule)

Every new component gets a **generic base class + a specific modifier class** (matching `.row`, `.qbody`, `button.link`): card `class="card learn-suggestion"`; chat container `class="chat grade-chat"`, turns `class="msg msg-user"`/`msg-assistant"`; grade badge `class="badge grade-badge grade-partial"`; primary actions `class="btn learn-answer"` etc. No CSS framework; styles in existing `styles.css`.

## Error handling

- `/transcribe` provider failure → `502 { error: 'transcription failed' }`; UI shows retryable error, keeps photos/typed text.
- `/grade` provider failure → `502 { error: 'grading failed' }`; UI shows retryable error, keeps the conversation/answer.
- Missing question on any route → `404`.
- Bad input (neither photo nor typed answer on commit; empty conversation on grade; missing/invalid grade) → `400`.
- Non-image upload on `/transcribe` → `400`.
- `completeStructured` validates against the schema with retry in the LLM layer.

## Testing (Vitest, co-located `*.test.ts`)

- **Server**
  - `attempts` repository round-trips (create / list-by-question), including `imagePaths`/`transcription`.
  - `LlmProvider` generalization: `fake-provider` implements `complete`/`completeStructured`, records the last conversation; existing extraction tests pass against the refactored interface.
  - Extraction refactor through `completeStructured` (parse/validate envelope; existing route tests green).
  - `/transcribe` route: saves images, returns `{ transcription, imagePaths }`, 404/400(non-image)/502 — using `fake-provider`. Asserts the question text is included as reference and the transcribe-only framing is in the prompt (prompt-content assertions on the contract).
  - Transcription contract: prompt contains the hard "do not solve/correct/complete/grade" guard and marks the question as reference-only.
  - `/grade` route: replays conversation, returns `{ critiqueText, recommendedGrade }`, 404/400(empty)/502.
  - `/attempts` create + list; 400 when neither photo nor typed answer; un-attempted ⇒ empty.
  - PATCH skip/snooze sets fields; `null` clears snooze.
  - `learn/next` service: ordering and exclusion of attempted/skipped/actively-snoozed; snooze expiry re-includes.
  - Extraction contract: label always present, position-based fallback.
- **Client**
  - Reusable image-input component: emits selected file(s); multi-file mode.
  - `learn/next` rendering + empty state; Skip / Not now wiring.
  - Answer view: Transcribe & continue requires a photo or typed text; transcribe → confirm shows editable transcription; grade turn renders a badge; Save commits with `imagePaths`/`answerText`/`transcription`.
  - DOM render of question/transcription via `renderContent` (jsdom).

## Build order (vertical slivers, each demonstrable)

1. **Generalize `LlmProvider`** (+ `ImageRef`, `fileImage`/`bufferImage`); refactor extraction onto `completeStructured`; keep extraction working in the browser. *(Observable: extraction still works.)*
2. **Label-extraction improvement** in the contract. *(Observable: newly extracted questions show labels.)*
3. **`Attempt` model + repository** in `Store`; `/attempts` create+list (with `imagePaths`/`transcription`, neither-present ⇒ 400). *(Observable: an attempt can be created via API/seed and listed.)*
4. **Reusable image-input component**; migrate the extraction pane onto it. *(Observable: extraction still works, now via the shared component.)*
5. **`/transcribe`** + transcription contract; **answer step → transcribe → confirm** in a minimal Learn view. *(Observable: photograph the test image, see the transcribed LaTeX, edit it.)*
6. **`/grade`** + grading contract; grading chat + rating; **Save attempt**. *(Observable: full photo→transcribe→confirm→grade→rate→save loop in the browser, using `1-A-2_solution.jpg`.)*
7. **Skip/snooze PATCH** + `learn/next` service + suggested-next card + navigator. *(Observable: suggested next, Skip/Not now, pick-your-own.)*

## Test asset

`~/Downloads/1-A-2_solution.jpg` — a photo of handwritten working for question **1.A.2** (`z = -1/2 + √3/2 i`, showing `z³ = 1`). Use it to exercise transcription + grading end-to-end in slivers 5–6. (`~/Downloads/test_problems_01.jpg` is printed questions, for the extraction path.)
