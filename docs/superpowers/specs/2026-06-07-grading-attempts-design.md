# Grading — Attempts & the Learn tab (vertical slice)

**Status:** Approved design.
**Date:** 2026-06-07
**Parent:** [Question Bank — System Architecture](./2026-06-06-question-bank-architecture.md) (the "Grading" sub-project).

This is the **first vertical slice** of the grading sub-project: a working solve → grade → rate loop in the **Learn** tab for **typed** answers. It deliberately defers Phase 1 photo transcription and the SRS scheduler to their own specs.

## Goal

Let the user open a question, type an answer, and get LLM-assisted critique in a back-and-forth chat where **every LLM turn (including the first) carries a recommended grade** (`correct` / `partial` / `incorrect`, where *partial* means ≥70% of the way there). The user then sets the final rating, which is committed as an **Attempt**.

## Relationship to the architecture spec — divergences (recorded on purpose)

The architecture spec designed grading as a three-phase flow. This slice keeps that framing but narrows it:

- **Phase 1 (transcription)** — blind handwriting→LaTeX agent — is **deferred** to a follow-up spec. This slice takes a **typed, plain-text** answer instead of a photo.
- **Phase 2 (critique)** is built, and is realized as a **chat**: each LLM turn returns critique text + a recommended grade; the user can clarify back and forth and the LLM re-grades each turn.
- **Phase 3 (user decides)** is built: the user accepts or overrides the recommended grade.
- The architecture spec's richer `Attempt` (with `transcript`, `canonicalAnswer`, `solutionSource`, `{text, guidingRating}` critique) is **collapsed to final-state-only** here (see Data model). The live conversation is **not persisted** server-side.
- Rating vocabulary is **`correct` / `partial` / `incorrect`** (the user's words). The architecture spec used `DNM / partial / full` for SRS; the **SRS sub-project** owns any mapping/rename. This slice does not implement the due-scheduler (untried/failed→ready, pass×1→week, pass×2→month, pass×3→done) — that is the Practice sub-project.

## Scope

**In this slice**

1. **General conversational `LlmProvider`** (`complete` / `completeStructured`), with the existing image-extraction call refactored onto it.
2. **`Attempt`** data model + JSON storage (final-state only).
3. **Skip / snooze** state on the `Question`.
4. **Phase 2 critique chat** + **Phase 3 rating**, via stateless full-transcript replay.
5. **Learn tab UI**: suggested-next card (Answer / Skip / Not now) + book→chapter→question navigator + grading view.
6. **Label-extraction improvement** (folded in): make extraction always produce a referenceable `label`.

**Deferred (own specs)**

- Phase 1 photo transcription (uses the `ImageRef` plumbing built here).
- SRS due-scheduler & prioritization (Practice tab).
- Answer LaTeX/KaTeX rendering (this slice renders the *question* with KaTeX but the *answer* is plain text).
- Persisting the full critique transcript.
- Provider/key/model configuration via UI/API (separate future feature).

## Data model

### New entity: `Attempt` (`data/attempts.json`)

A new `JsonCollection`/`Repository<Attempt>`, opened in `Store` alongside the others. **Final-state only** — the in-flight chat is never stored server-side.

```
Attempt
  id                string (uuid)
  questionId        string                                   // → Question
  answerText        string                                   // user's final typed answer (plain text)
  recommendedGrade  "correct" | "partial" | "incorrect"      // last grade the LLM gave
  rating            "correct" | "partial" | "incorrect"      // user's final decision (accept/override)
  critiqueText      string                                   // the LLM's final critique message
  createdAt         ISO timestamp
```

A question may accumulate **multiple** attempts. "Un-attempted" (for the suggestion) means **zero** attempts.

### `Question` additions (skip / snooze — mutable current state)

```
skipped        boolean?        // "Skip" = never suggest again
snoozedUntil   ISO timestamp?  // "Not now" = suggest again after this time (12h from now)
```

Both optional, consistent with the existing optional `relevance` / `nextReviewDate`. Set via the existing question PATCH route (widened).

### Shared grade type

```ts
type Grade = 'correct' | 'partial' | 'incorrect';   // partial ⇒ ≥70% there
```

Used for both `recommendedGrade` and `rating`. Defined once in `domain/types.ts` and mirrored in the client `api/types.ts`.

## LLM conversational interface

Generalize `LlmProvider` to the architecture spec's shape; the existing `extractQuestionsFromImage` is re-expressed in terms of it.

```ts
type Role = 'user' | 'assistant';

/** A reference the provider resolves to bytes only when it serializes the turn. */
interface ImageRef {
  mimeType: string;          // 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  load(): Promise<Buffer>;   // lazy
}

interface Message {
  role: Role;
  text: string;
  images?: ImageRef[];       // unused by the grading slice; carried for Phase 1 later
}

interface CompleteOpts { /* model, timeout, etc. — provider-specific, optional */ }

interface LlmProvider {
  complete(conversation: Message[], opts?: CompleteOpts): Promise<string>;
  completeStructured<T>(conversation: Message[], schema: object, opts?: CompleteOpts): Promise<T>;
}
```

- **`ImageRef` decouples bytes from location.** Two constructors cover current needs; a third (`s3Image`) drops in later with no provider/route changes:
  - `fileImage(absolutePath, mimeType)` → `load()` reads from disk.
  - `bufferImage(bytes, mimeType)` → `load()` returns the in-memory buffer.
  The provider **never branches** on in-mem vs. file; it just calls `load()`.
- **Stateless full-transcript replay.** The server holds no session. Each turn the client sends the whole `Message[]`; the route replays it. This is what lets the in-flight grading chat live client-side.
- **Extraction refactor.** `extractQuestionsFromImage` becomes a thin wrapper over `completeStructured` (one user `Message` carrying a `bufferImage` + the extraction schema). The extraction route can pass `file.buffer` directly via `bufferImage`, avoiding a redundant disk re-read. `fake-provider` and `anthropic-api-provider` implement the two new methods.
- **Grading uses `completeStructured`** so the schema *forces* a recommended grade on every turn, including the first.

```ts
// grading-turn schema
{ critiqueText: string, recommendedGrade: 'correct' | 'partial' | 'incorrect' }
```

### Grading prompt (provider-agnostic, in a contract module like `extraction-contract.ts`)

Hard constraints:

- Grade the user's answer to **this one titled question only**. Do **not** solve other problems, wander to adjacent exercises, or introduce material beyond what's needed to judge *this* answer.
- **React to the user's answer**; do **not** independently produce a full worked solution.
- Every turn returns `critiqueText` + a `recommendedGrade`. `partial` means the answer is ≥70% of the way there.
- Context provided to the grader: the question's `canonicalText`, the chapter `description`, and the book `learningGoal` (when present).

## API

REST, resource-oriented, nested where natural — matching the existing routers.

### Grade a turn (stateless; nothing persisted)

```
POST /api/questions/:id/grade
  body:  { answerText: string, conversation: Message[] }   // full transcript, client-owned
  reply: { critiqueText: string, recommendedGrade: Grade }
```

Called every turn. The route loads the question (404 if missing), builds the grading context, replays `conversation` through `completeStructured`, returns the next turn. On provider failure → `502` (mirrors the extraction route's `LlmError` handling).

### Commit an attempt (Phase 3) / history

```
POST /api/questions/:id/attempts
  body:  { answerText, recommendedGrade, rating, critiqueText }
  reply: 201 Attempt
GET  /api/questions/:id/attempts
  reply: Attempt[]            // empty ⇒ un-attempted
```

### Skip / snooze (widen existing PATCH)

```
PATCH /api/questions/:id
  body: { skipped?: boolean, snoozedUntil?: string | null }   // plus existing canonicalText/label
```

`Not now` sends `snoozedUntil` = now + 12h. `Skip` sends `skipped: true`. Passing `null` clears a snooze.

### Suggested next

```
GET /api/learn/next
  reply: { question: Question, book: Book, chapter: Chapter } | { question: null }
```

A **service-layer** query (plain filter over `getAll()`, like `services/tree.ts` / `services/cascade.ts`): questions where attempts count is `0`, `skipped !== true`, and (`snoozedUntil` unset **or** in the past), ordered by **book order → `chapter.order` → question `createdAt`**, returning the first with its book + chapter. (Book order: current book array order; revisit if explicit book ordering arrives.)

## Label-extraction improvement (folded in)

Today's extraction leaves `label` blank too often. Update `extraction-contract.ts` so the agent **always** yields a referenceable `label`:

- Prefer a real label from any page signal: the question's own visible number, "Problem N" / "Exercise N" phrasing, section/chapter numbers, page header/footer (top/bottom of page), and the chapter the questions are being added to.
- **Position-based fallback** when no real label exists: an ordinal within the extraction batch (`#1`, `#2`, …), or `p.<page>-<n>` when a page number is visible. The agent prefers a real label and only falls back when none can be found.
- Make `label` effectively always present from extraction. (The field stays optional in the type for manual creation, but the extraction path should not return blanks.)

The extraction prompt's "do not solve/answer/hint" constraint is unchanged.

## Client / UI (Learn tab)

Replaces the `renderLearn` stub. Top → bottom:

1. **Suggested-next card** — `GET /api/learn/next`. Shows label + KaTeX-rendered question body (reuse `render/content.ts`). Buttons: **Answer**, **Skip** (PATCH `skipped:true`), **Not now** (PATCH `snoozedUntil` = +12h). Empty state when `question: null`.
2. **Navigator** — book → chapter → question drill-down (same tree data as Manage) to pick any question and open its grading view.
3. **Grading view** (opens on Answer / pick):
   - Question (label + KaTeX body).
   - **Plain-text `textarea`** for the answer.
   - **Chat transcript** held in client memory (lost on reload — by design, "client-side only until rated"): user turns + LLM turns, each LLM turn rendering `critiqueText` and a **recommended-grade badge**. Each turn POSTs the full `conversation` to `/grade`.
   - Reply box to clarify; re-grades each turn.
   - **Rating control** (accept recommended or override) → **Save attempt** POSTs to `/attempts`, then returns to the suggested-next card (which advances, since the question now has an attempt).

### Styling convention (standing rule for new components)

Every new component gets a **generic base class + a specific modifier class**, so future CSS can target either the shared look or one component without markup churn — matching the existing semantic style (`.row`, `.qbody`, `button.link`). Examples:

- card: `class="card learn-suggestion"`
- chat: container `class="chat grade-chat"`; turns `class="msg msg-user"` / `class="msg msg-assistant"`
- grade badge: `class="badge grade-badge grade-partial"` (one modifier per grade)
- inline actions reuse `button.link`; primary actions get `class="btn learn-answer"` etc.

No new CSS framework. Styles go in the existing `styles.css` using these hooks; heavy visual polish is a later pass.

## Error handling

- Provider/LLM failures on `/grade` → `502 { error: 'grading failed' }`; the UI shows a retryable error and keeps the typed answer.
- Missing question on any route → `404`.
- Bad input (empty `answerText`, missing `rating`/`recommendedGrade` on commit, invalid grade value) → `400`.
- `completeStructured` validates against the schema with retry in the LLM layer (per the architecture spec's safety-net design).

## Testing (Vitest, co-located `*.test.ts`)

- **Server**
  - `attempts` repository round-trips through `JsonCollection` (create / list-by-question).
  - `/grade` route: replays conversation, returns `{ critiqueText, recommendedGrade }`, 404/400/502 paths — using `fake-provider`.
  - `/attempts` create + list; un-attempted ⇒ empty.
  - PATCH skip/snooze sets fields; clearing snooze with `null`.
  - `learn/next` service: ordering (book→chapter.order→createdAt) and exclusion of attempted / skipped / actively-snoozed; snooze expiry re-includes.
  - Extraction contract: label always present, position-based fallback when no real label (assert via `fake-provider` shaped output / prompt expectations).
  - `fake-provider` implements `complete` / `completeStructured`; existing extraction tests pass against the refactored interface.
- **Client**
  - `learn/next` rendering + empty state; Skip / Not now wiring.
  - Grading view: each turn renders a grade badge; Save commits an attempt.
  - DOM render of question via `renderContent` (jsdom, as existing tests do).

## Build order (for the implementation plan — vertical slivers, each demonstrable)

1. Generalize `LlmProvider` (+ `ImageRef`, `fileImage`/`bufferImage`); refactor extraction onto `completeStructured`; keep extraction working in the browser. *(Observable: extraction still works.)*
2. Label-extraction improvement in the contract. *(Observable: newly extracted questions show labels.)*
3. `Attempt` model + repository in `Store`; `/attempts` create+list. *(Observable: an attempt can be created via API/seed and listed.)*
4. `/grade` endpoint + grading contract; minimal Learn grading view (typed answer → critique + badge → save). *(Observable: solve→grade→rate loop in the browser.)*
5. Skip/snooze PATCH + `learn/next` service + suggested-next card + navigator. *(Observable: suggested next, Skip/Not now, pick-your-own.)*
```
