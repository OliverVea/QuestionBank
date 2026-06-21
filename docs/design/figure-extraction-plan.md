# Figure extraction — implementation plan (draft)

> **Status:** Draft · partial plan. Covers **Motivation, User flow, API interaction,
> Persistence**, with the cross-cutting product decisions now settled (see Decisions).
> Per-component design, prompts, and the `figureRefs` schema are still to spec. Builds on
> `figure-extraction-hld.md` (framing) and the `extract-figures.html` mock (UX). Grounded
> in the deployed `figure-service` and the existing `POST /api/extract` + JSON storage.

## Motivation

- The **image half** (UVDoc dewarp + DocLayout-YOLO detection) already ships as the
  deployed `figure-service` (`POST /v1/process` → rectified PNG + figure boxes). The
  **problem half** already ships as `POST /api/extract` (page images → add/edit/skip
  envelope). This plan **composes** them — plus a matcher — into one capture→review
  flow, so a photographed page yields problems *with their diagrams attached*.
- Today a problem is just `canonicalText` (LaTeX/markdown); any problem that says "see
  Figure P5.32" renders incomplete. Attaching the referenced figure closes that gap.
- The spike proved matching is **cheap** (~4¢ / 6 pages on Haiku 4.5) so we can iterate
  freely. The mock has already pinned the UX; this is the bridge to a spec.
- **The one hard reversal:** figures must be **persisted**. Current policy stores *no*
  image bytes (`QuestionSource`: "No image is persisted"). Figures break that on
  purpose — sign-off + a storage decision are prerequisites (see Persistence).

## Relationship to the current scan flow (decided)

The current prod scan (`ScanProblemsPage`) is a **chat** over `POST /api/extract`,
**book-scoped**, that dedupes against the book's existing problems and emits
`add`/`edit`/`skip` deltas (+ relevance, + `needsSection` prompts). The figure flow keeps
the *data model*, swaps the *UI paradigm*:

- **Wizard, not chat.** The figure flow is the mock's linear 3-step wizard. (A future
  enhancement could add an AI "make bulk changes to the questions" affordance — but that
  edits problem **text**, not figures, and is out of scope here.)
- **Launched from a book** (stashed `bookId`), like today's scan — not a new entry point.
- **Still book-scoped, still dedupes.** The wizard runs the same `/api/extract` and the
  **extraction agent keeps deciding new-vs-existing** (`add`/`edit`/`skip`), exactly as
  today. The wizard is *not* bookless — this dissolves the earlier "figures need persisted
  questions vs. a bookless mock" tension: questions are committed into a book as they are now.
- **Matching is scoped to NEW questions only.** The matcher considers only the `add`
  problems. Existing problems reached via `edit`/`skip` get **no auto-matched figures** in
  v1; attaching/detaching figures to/from already-saved questions is a deliberate
  follow-up, not v1. So figure references are only needed on `add`s.
- **`needsSection` and relevance survive.** They're book-scoped behaviors we keep; the
  wizard's review step must still surface them (open detail below — how much of the delta
  review the wizard shows).

## User flow

Mirrors the mock's 3-step wizard + box-drawing subpage.

1. **Pictures** — user photographs / confirms the page(s); add or remove pages before
   extracting. (Reuses the existing capture entry; ≤5 pages, the current extract limit.)
2. **Extract** (progress screen) — two independent jobs run **in parallel**:
   - `figure-service` dewarps each page → rectified image + figure boxes (reading order).
   - Claude reads problems → content + per-problem **figure references** (`label`).
   - **Then, conditionally:** if any problem carried references, the **matcher** assigns
     each detected figure to a problem. No references ⇒ skip the match call entirely.
   - **Progressive:** problems render as soon as extraction returns; figure thumbnails
     fill in when detect + match complete. The screen never blocks on the slowest job.
3. **Review & edit** — problems in reading order, each with its attached figure thumbnails:
   - **Tap text to edit** the LaTeX/markdown (same editor as the rest of the app).
   - **Add / edit / remove a figure per problem.** Add/edit opens the subpage: draw a
     box on the **rectified** page, or tap a detected-figure guide, then resize via edge
     handles. A figure **is a box** on the page; the client cuts the crop for display.
   - **v1 = rectified page only.** Adding from the *original* (un-dewarped) photo needs a
     4-point perspective warp — deferred to phase 2. Detected-figure guides only show on
     the rectified view (the detector's coordinate space).
   - **Unfulfilled references flagged.** When a problem's `figureRefs` lists a cited caption
     that no figure ended up attached to, that problem shows a small **(!)** marker, nudging
     a manual add. (Arises when matching missed, or was skipped because the detector
     returned no figure for that reference.)
   - **Continue** commits the reviewed problems + figures.

## Stage 4 — review & confirm (design)

The wizard's final step **re-houses the current prod delta-review inside the wizard** and
grafts figures onto the new problems. Keeping the delta semantics visible (not just "new
problems with figures") is deliberate — it preserves dedupe transparency, relevance, and
section-gating that the chat flow has today. Renders once from the `/api/scan` response (no
streaming). A short lede summarizes counts ("3 new, 1 fix, 2 already in your book").

**Cards by delta kind** (reading order; `skip`s grouped/collapsed at the bottom):

- **`add` (new problem)** — the only figure-bearing card:
  - Editable **text** (KaTeX/markdown) — tap to edit, as in the mock.
  - **Figure thumbnails** for matched figures (cut in-session from the rectified page),
    each with edit-box / remove; plus **+ add image** → the box subpage.
  - **(!) marker** when a `figureRef` went unfulfilled (manual-add nudge).
  - **Relevance chip** (when the book has a learning goal) and the **path label**.
  - **Accept/reject toggle** (default accepted) — rejecting drops the problem *and its figures*.
- **`edit` (text improvement to an existing problem)** — **no figures in v1** (matcher
  never touches existing problems): **before → after** text, the *after* tap-to-edit,
  accept/reject toggle, path label.
- **`skip` (already in book)** — informational only: muted, no toggle, no figures; grouped
  under an "N already in your book" expander to keep the list clean.

**`needsSection` gate** — pages the agent couldn't place surface as **blocking prompts** at
the top of the review (one per page). Commit stays disabled until all are answered;
answering triggers a `refine` that re-renders the list. This is the **only** refine in v1 —
the freeform "refine the problems…" chat input is dropped (AI bulk-edit is a deferred
enhancement that would touch text, not figures).

**Commit ("Continue")** — enabled when ≥1 `add`/`edit` is accepted and no `needsSection`
prompt is pending. On commit:
  1. Persist accepted problems via the existing question CRUD (adds create, edits update),
     then resync to learn the new questions' **ids** (mirrors today's `applyReturnedScanProblems`).
  2. For each accepted `add`'s figures: **bake the crop** from the in-session rectified page
     and `POST /api/questions/:id/figures` (→ `imgs/<id>.webp`). Figures attach *after* ids
     exist. Rejected problems and their figures are never sent.

**Out of scope for stage 4 (v1):** figures on `edit`/`skip` problems; post-commit box
editing; progressive/streamed rendering; freeform AI refine.

## API interaction

The figure-service key stays server-side. **One server endpoint, `POST /api/scan`,
orchestrates the read pipeline; commit happens through small figure-CRUD endpoints.**

**Pipeline (server-side), staged `(1 ∥ 2) → 3`** — review/edit (stage 4) is client-side:

1. **Flatten** — figure-service `/v1/process` per page → rectified page + figure boxes.
2. **Extract problems** — the existing extraction logic (book-scoped dedupe →
   `add`/`edit`/`skip` deltas, relevance, `needsSection`), now **also emitting per-problem
   `figureRefs: string[]`** — the figure **caption labels the problem cites**, read off the
   page (e.g. `["Figure P5.32"]`). References belong to this stage by design — *not* a
   separate pass. Stages 1 and 2 are independent and run concurrently.
3. **Match** *(conditional)* — Claude **Haiku 4.5**: figure crops (in order, cut
   server-side from the rectified page for the model call) + the **new** (`add`)
   problems-with-`figureRefs` + the rectified page → per figure
   `{ printed_label, matched_question_label, confidence }`; **no box coords in the prompt**.
   **Runs only when *both* hold:** at least one `add` carries a `figureRef` (stage 2) **and**
   stage 1 returned ≥1 figure. No refs → nothing to attach; no detected figures → nothing to
   match against. Either missing ⇒ skip the call entirely. (Only `add`s participate.)
   Matching spans the **whole scan in reading order** (not page-siloed), so a problem and
   its figure can straddle a page break.

- **`POST /api/scan`** *(new)* — multipart: page images + `bookId`. Runs `(1 ∥ 2) → 3` and
  returns one combined payload: the delta envelope (`add`/`edit`/`skip` + relevance +
  `needsSection`), the **transient** rectified page(s) (`png_base64` + dims), figure boxes,
  and figure→new-question matches. The client renders **stage 4** from this single
  response; the rectified page lives in client memory only (to draw boxes / cut crops).
  Reuses the extraction logic; the legacy chat `/api/extract` stays for now (the wizard
  supersedes that UI, retire later).
  - `needsSection` still gates commit; resolve via a refine call (reuse `/api/extract/refine`
    or a `/api/scan/refine` twin) — **TBD which**.
- **Commit (stage 4 → persistence)** — figures attach to the now-saved new questions:
  - `POST /api/questions/:id/figures` — multipart: the **baked crop** (webp) +
    `{ printedLabel?, confidence? }`. Server writes `imgs/<figureId>.webp` + the `Figure` row.
  - `DELETE /api/questions/:id/figures/:figId` — remove (drops the crop file).
  - No box move/resize in v1 — editing a committed figure = **replace** (see Persistence).
  - Problems commit via the existing question CRUD; `GET` figures (crop URLs) ride the
    book-questions read model.
- **Cross-cutting:** reuse multer limits (≤5 images, ≤10 MB each); customer scoping via
  `requireCustomerId`; figure-service 5xx/timeouts → clean `502`.

## Persistence

The deliberate reversal. Today: per-entity **JSON collections** (`books`, `questions`,
`attempts`, `skips`, `settings`), one file ↔ one array, every row `{id, customerId,…}`,
`Repository` contract already async for a future SQL/DDB backend. **No blob store exists.**

**Decision: persist the figure *crops* only** — not the original photo, not the full
rectified page. The box-on-a-page is an *editing-time* representation; the *persisted*
representation is the cut crop. This keeps storage small and the blob layer simple (no
page store, no ref-counting).

- **New blob storage, crops only.** Each crop is stored as an **individual file
  `imgs/<figureId>.webp`** under the data dir (a thin `BlobStore` wrapper, swappable for
  S3/object storage later). **One file per figure** — never pages or originals. The stored
  crop is the **full box-resolution cut** (not the 240px display thumbnail the mock makes),
  webp at a quality cap. Served via a **customer-scoped authed route** (not static), so one
  customer can't fetch another's crop.
- **New `Figure` entity** in its own JSON collection (`figures.json`) + a `Repository`
  added to `Store`:
  ```ts
  interface Figure {
    id: string; customerId: string;   // standard scoping
    questionId: string;               // owner; book reachable via the question
    cropImageId: string;              // → BlobStore (the baked crop bytes)
    printedLabel?: string;            // matcher's read of the caption ("Figure P5.32")
    confidence?: number;              // matcher confidence; absent for user-added
    createdAt: string;
  }
  ```
- **Crop is baked at commit.** During the scan the client holds the rectified page in
  memory and the user manages a box on it (mock `cut()`); at **Continue** the client cuts
  the crop once and uploads the bytes. The rectified page and the original photo are
  **transient** — never persisted.
- **Consequence — no post-commit box editing (confirm).** Once committed, a figure is just
  its crop; the surrounding page is gone, so re-drawing/resizing the box later isn't
  possible — editing a saved figure means **replacing** it (re-scan, or pick a new crop).
  The mock's draw/resize subpage is thus a *within-scan-session* tool. If we ever want
  post-commit box editing we'd have to persist the rectified page after all.
- **`QuestionSource` unchanged.** Figures are a *separate* entity, not a new `Question`
  field; a problem with zero figures is byte-identical to today (backward compatible).
- **Lifecycle / cascade:** deleting a question drops its figures' crops; deleting a book
  cascades through its questions. No ref-counting (one crop ↔ one figure). Fits the
  existing cascade service.

## Decisions (settled)

- **Wizard, not chat** — book-scoped, reusing the existing extraction dedupe.
- **Pipeline `(1 ∥ 2) → 3 → 4`** — 1 flatten, 2 question extraction + diffing (refs
  included), 3 figure matching, 4 user edit + confirm.
- **One server endpoint `/api/scan`** orchestrates 1–3 (not a client fan-out).
- **References live in the extraction stage** (per-problem `figureRefs`), not a separate pass.
- **Matcher runs over new (`add`) problems only**, and **only when** some `add` has a
  `figureRef` **and** the detector returned ≥1 figure (else skip). Existing problems get no
  auto-matched figures in v1; attach/detach to saved questions is a follow-up.
- **Unfulfilled references get a (!) marker** in review, prompting a manual add.
- **Stage-4 review shows all delta kinds** (`add`/`edit`/`skip`), with figures + (!) on
  `add`s only; one commit button; `needsSection` gates commit; no freeform refine. (See
  "Stage 4 — review & confirm".)
- **`figureRefs` = cited caption labels** (`string[]`) per problem; (!) fires when a cited
  label has no figure attached.
- **v1 stops at capture → review → persist.** Rendering attached figures where problems are
  studied (grade chat, learn, view-book) is a **separate follow-up**, not v1.
- **Defaults:** match the whole scan in reading order; store full box-resolution webp crops
  served via an authed customer-scoped route; launch from a book like today's scan.
- **Labels are agent-assigned** from the page + existing questions → the matcher matches a
  figure to a *question*, so there's no "bare label vs dotted path" namespace to reconcile.
- **`needsSection` and figure matching are independent** — matching is content/caption-based;
  the section answer only sets the question's path label.
- **Persist crops only**, as `imgs/<figureId>.webp` files. No originals, no pages. Approved.
- **Edit = replace** in v1; no post-commit box editing (would require persisting the page).

## Remaining detail (for the spec)

- **`needsSection` refine path** — reuse `/api/extract/refine` or add a `/api/scan/refine` twin.
- Per-component design, the extraction/matcher prompts, and error/retry semantics.
