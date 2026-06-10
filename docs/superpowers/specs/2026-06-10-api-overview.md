# API overview — flat problems model (v0)

**Date:** 2026-06-10
**Status:** Draft mapping. Entities + CRUD the v0 mocks require, annotated with
the mock functionality each endpoint serves.

This maps the API against the v0 mocks (`docs/mocks/`) now that customer
segmentation has landed. The model is a **flat, ordered list of problems under a
book** — no chapters, no sections (TODO 16). This is a **clean rewrite**: we
keep no backwards compatibility for the API or the storage and migrate no
existing data, so the model below is stated as the target, not as a diff from
today's server (see "Clean rewrite" at the end for orientation).

Every `/api` route resolves the active customer first (segmentation, already
built); unattributed requests are `401`, cross-customer reads `404`. That
behavior is assumed below and not repeated per-row.

## Read-only compute vs. persisted commits

A principle that shapes the whole surface: **the LLM / chat endpoints are
read-only — they compute and return, they never persist.** What they produce
lives in the client's in-memory working set until the user makes a deliberate
**commit**, and only the commit writes to the backend. There are exactly two
commits:

- **book Save** (`PATCH /books/:id` + `PUT /books/:bookId/questions`) — persists
  the edited metadata and problem list, including anything scanned in;
- **save attempt** (`POST /questions/:id/attempts`) — persists a grading result,
  and *only* when the user actually grades it.

So `extract`, `transcribe`, and `grade` write **nothing**. A scan delta, a
transcription, a grade-with-issues are all proposals the user can edit, accept,
or discard; persistence happens later, through one of the two commits above.
This keeps the chat surfaces stateless and means an abandoned scan or an
ungraded answer leaves no trace.

**Skip is client-only (v0).** The "Skip" action doesn't persist anything — in the
session loop it just advances to the next item (offset + 1), and the skipped
question reappears next session because nothing about it was written. There is no
snooze field and no snooze endpoint. (Trade-off: a skip doesn't survive closing
the app — acceptable for a v0 "not this pass" skip; a persisted snooze could be
added later if real use wants it. The mocks' "Skip 12h" label should drop the
"12h" — there's no timed snooze, it's just Skip.)

---

## Entities

### Book
The unit in the library. Gains ISBN-lookup metadata. **Owns the order and
membership of its problems** via `questionIds`.

| field | notes | mock source |
| --- | --- | --- |
| `id` | | |
| `customerId` | owning customer | segmentation |
| `title` | required | add/edit-book Title field |
| `author?` | | add/edit-book Author field |
| `learningGoal?` | | add/edit-book "Learning goal" textarea (TODO 7a) |
| `isbn?` | enables cover + re-lookup | add/edit-book ISBN field + barcode scan |
| `publisher?` | | lookup record → "publisher · year" meta line |
| `year?` | | lookup record → meta line |
| `questionIds` | **ordered** array of question ids — the problem list's order **and** membership | problems-list sequence + drag-to-reorder (TODO 16d) |
| `createdAt` | | history/stats (TODO 5c) |

Cover image is **not stored** — the client resolves it from the ISBN against
Open Library (see `index.html` / `add-book.html` `resolveCover`). The server
only persists `isbn`.

**Ordering model.** `questionIds` is the single source of truth for both order
and membership — the array position *is* the order, so two problems can never
share a position or leave a gap (the failure mode of a per-item `order` int).
There is no `order` field on the question.

Because the array and the questions can in principle drift (a crash between the
two writes), `GET /books/:bookId/questions` **reconciles defensively**: any
question with this `bookId` that is missing from `questionIds` is **appended** (a
half-written create surfaces last, never vanishes); any id in `questionIds` with
no surviving question is **dropped**. The reconciled array is written back, so the
list self-heals on read. (`GET /books/:id` returns the book record as-is; the
questions endpoint is the authority for the rendered order.)

### Question ("problem")
Re-rooted from `chapterId` to `bookId`. Order lives on the book, not here.

| field | notes | mock source |
| --- | --- | --- |
| `id` | | |
| `customerId` | | segmentation |
| `bookId` | **was `chapterId`**; ownership + reconcile back-pointer | problems belong to the book directly |
| `label` | **required**, defaults to 1-based index, editable (e.g. "1.A.3") | problems-list row label; null in mocks = "auto-number" (TODO 16b) |
| `canonicalText` | LaTeX/markdown source of truth | rendered problem body |
| `source` | `{ kind: 'image' \| 'text' }` — see note | scan vs. "Add a problem" manual |
| `createdAt` | | history/stats |

There is **no skip / snooze state** — "Skip" advances the session client-side
only (nothing persisted; see the commits principle above), and a problem the user
never wants again is deleted.

`nextReviewDate` is **not stored**: due-ness is derived from attempt history by
the practice queue (so there's no live SRS field to keep in sync here).
`relevance` (TODO 7b) is omitted until that feature is built.

**Source note (TODO 3e):** the image-persistence path is being removed —
`imagePath` leaves `QuestionSource`; extract/transcribe take image bytes
transiently and never write them to disk. `source` collapses toward
`{ kind, rawText? }`. Mapped toward that target, not the current on-disk model.

### Attempt
A committed grading attempt. Shape essentially unchanged.

| field | notes | mock source |
| --- | --- | --- |
| `id` / `customerId` / `questionId` | | |
| `answer` | the user's answer as one block of inline-LaTeX text | grade chat answer (photo path → confirmed/edited; typed path → entered directly) |
| `recommendedGrade` | grader's suggestion | grade badge + "Suggested" ring |
| `rating` | user's final correct/partial/incorrect | grade-row buttons |
| `issues[]` | `{ severity, description }` | issue-list in grader bubble |
| `createdAt` | | history/stats |

**One answer field.** The photo path (confirm/edit the transcription) and the
typed path ("or type it instead") both converge on the same thing — user-authored
inline-LaTeX — so they collapse into a single `answer` field rather than separate
`transcription` / `answerText`. Whether it came from a photo or was typed is
upstream of what's stored.

**Per TODO 3e:** no image bytes are persisted on the attempt (**no
`imagePaths`**) — retranscribe needs the image re-uploaded. The full chat
transcript is *not* stored in v0 (TODO 3b is the future "persist transcript").

---

## Endpoints

### Books — library + add/edit/delete

| method + path | what it does | mock functionality served |
| --- | --- | --- |
| `GET /api/books` | list the customer's books | **index.html** "Your library" rows |
| `GET /api/books?view=library` | list **with derived** `progress%` + `ready` count | index.html per-row `42%` / `3 ready` (TODO 5a/6c) |
| `POST /api/books` | create a book from metadata (title required → 400 if blank); returns its id | **add-book** "Add to library" (book record) |
| `GET /api/books/:id` | one book record + metadata | **edit-book** prefill |
| `PATCH /api/books/:id` | edit title/author/goal/isbn/publisher/year | **edit-book** "Save changes" (metadata part) |
| `DELETE /api/books/:id` | cascade-delete book + its questions + attempts | manage-books delete (TODO 15d undo is future) |

There is **no combined book+problems read**. edit-book opens by calling
`GET /books/:id` and `GET /books/:bookId/questions` **concurrently**
(`Promise.all`) — the two requests overlap, so it costs one round trip, with no
extra endpoint to build or name. (The old chapter-era `/tree` read is gone.)

Save is symmetric: tapping "Save changes" fires `PATCH /books/:id` (metadata) and
`PUT /books/:bookId/questions` (the problem list) **concurrently** — book fields
and the problem list are the two independent halves of the screen's working set.

**add-book** holds the same in-memory working set for a *new* book and persists it
on "Add to library": `POST /books` to create the record (gets the id), then
`PUT /books/:bookId/questions` to save its initial problem list — sequential here
because the problems need the new book's id. (The two halves can't go fully
concurrent the way edit-book's can, since the questions batch is addressed by the
freshly-created id.)

### Questions — the flat problem list under a book

The edit-book / add-book screens hold the **entire working set in memory** until
the user taps Save — metadata, problem adds/edits/deletes, and reordering are all
local until then, behind a dirty flag + unsaved-changes guard (already in the
mocks). So problems are **not** mutated one-at-a-time; Save sends the whole list
in one batch.

| method + path | what it does | mock functionality served |
| --- | --- | --- |
| `GET /api/books/:bookId/questions` | ordered, **reconciled** problem list for a book (authority for render order) | edit-book problems list load |
| `PUT /api/books/:bookId/questions` | **batch save** the full ordered problem list; server diffs against stored state (create / update / delete) and sets order from array position, in one atomic write | **edit-book "Save changes"** + add-book "Add to library" (problems part); covers add / edit / delete / **reorder** (TODO 16c/16d) |
| `GET /api/questions/:id` | one problem | learn/grade question body |

**Batch save semantics (`PUT …/questions`).** The body is the full ordered array
the list should end up as. Each item either has an `id` (existing) or not (new):

- item with `id` in the store → **update** (`label`, `canonicalText`);
- item with no `id` → **create**;
- a stored question for this book whose `id` is **absent** from the array →
  **delete** (cascading its attempts);
- **order** = array position → written to `book.questionIds`; reordering needs no
  separate call, it's just a new sequence in the saved array;
- applied as **one atomic write**, so a partial save can't leave the list
  half-updated.

This replaces per-item create/patch/delete and a standalone reorder endpoint:
because the screen is in-memory-until-Save, there is no moment where a single
problem mutation needs its own request. There is **no snooze or skip endpoint** —
"Skip" advances client-side only (see "Read-only compute vs. persisted commits"
above), and a problem the user never wants again is deleted via the batch save
(omitted from the array).

### Scan → delta ingestion (TODO 17)

| method + path | what it does | mock functionality served |
| --- | --- | --- |
| `POST /api/books/:id/questions/extract` | image bytes → **proposed delta** (`add` + `edit` items), nothing persisted | **scan-problems** photo → agent reply with delta cards |

There is **no separate apply/persist endpoint**. In the mocks, "Add to book"
hands the accepted problems back to edit-book (via `sessionStorage`), which
appends them to the **in-memory** list and marks the form dirty — they're
persisted only when the user taps the book's Save, through the same
`PUT /books/:bookId/questions` batch as any other edit. So scan-accepted items
are just new entries in the next batch save; `extract` is the only scan-specific
endpoint.

Generation/refine details (the conversational re-propose round-trip,
scan-problems "Refine the problems…") are deferred to the LLM work — this pass
maps `extract` returning a delta; the accepted set lands via the batch save.
Image bytes are transient (TODO 3e).

> **Implementation status (2026-06-10):** the flat-problems rewrite landed the
> books/questions/attempts/transcribe/grade/lookup surface. `POST …/extract`
> (scan → delta) is **designed but deferred** to the LLM work — accepted scan
> items already ride the book's batch `PUT`, so nothing else blocks on it.

### Grading loop (learn → grade)

| method + path | what it does | mock functionality served |
| --- | --- | --- |
| `POST /api/questions/:id/transcribe` | **read-only:** answer image bytes → inline-LaTeX text (transient image); the user confirms/edits it into the `answer` | learn **"Upload picture of solution"** → transcription |
| `POST /api/questions/:id/grade` | **read-only:** stateless grade of an answer → `{ recommendedGrade, issues[], reasoning }` | grade chat grader turn (badge + issues + reasoning) |
| `POST /api/questions/:id/attempts` | **the only write:** persist the attempt with the user's rating | grade-row **Correct / Partial / Incorrect** save |
| `GET /api/questions/:id/attempts` | list past attempts | future past-attempt card (TODO 4a) |

`transcribe` and `grade` persist **nothing** — they're the read-only compute side.
The whole grading chat (the transcription, every grader turn, every clarification,
re-grades on reply) lives only in the client until the user picks a final grade;
`POST …/attempts` is the single write, so an answer the user never grades leaves
no trace. `grade` is stateless — re-graded fresh on each reply, no server-side
session.

### Queues — what to learn / revisit next

| method + path | what it does | mock functionality served |
| --- | --- | --- |
| `GET /api/learn/next` | next un-attempted / eligible question | **index** "Next up: …" banner; learn screen content |
| `GET /api/practice/due` | due-for-review questions (SRS) | **index** "Revisit: N waiting" banner; practice loop |
| `GET /api/practice/due?count=true` | just the due count | index revisit banner number |

These back the home-screen banners and the session loop (TODO 19), which walks
`learn/next` / `practice/due` until empty.

### ISBN lookup (TODO 9a)

| method + path | what it does | mock functionality served |
| --- | --- | --- |
| `GET /api/lookup/isbn/:isbn` | external catalog → `{ title, author, publisher, year }` | add/edit-book **"Look up"** + barcode scan prefill |

A read-only, network-dependent endpoint (not CRUD). The mock fakes its response
inline (`SAMPLES`); the server owns the real catalog call. Cover bytes are not
returned — the client resolves the cover from the ISBN itself.

---

## Clean rewrite — no backwards compatibility

This is a **clean rewrite** of the API and the storage layer; there is no
migration from the current chapter-based model and no on-disk data to preserve.
The points below are orientation for anyone holding the old model in their head,
not a migration plan:

- No `Chapter` entity, no `/api/chapters*` routes. Books own problems directly.
- Questions root under `/api/books/:bookId/questions`, not under a chapter.
- `Question` has `bookId` (not `chapterId`) and no `order`; order lives in
  `book.questionIds`.
- No persisted images (TODO 3e): `QuestionSource` carries no `imagePath`,
  `Attempt` carries no `imagePaths`; images flow transiently to the LLM.

Because nothing is being migrated, the storage layer can be rebuilt to fit this
model directly (e.g. a `questionIds` array on the book record) rather than
retrofitted.

## Deliberately out of scope this pass

- Conversational refine round-trip for scan + grade (LLM chat surface).
- Persisting the grading transcript (TODO 3b).
- Relevance scoring + editing (TODO 7b/7c).
- History/revert (TODO 15) and backups (TODO 10).
- Session-loop bookkeeping (TODO 19c-e) — the queues exist; the counter does not.
