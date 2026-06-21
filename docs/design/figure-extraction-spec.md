# Figure extraction — implementation spec (v1)

> **Status:** Buildable spec. Implements the decisions in `figure-extraction-plan.md`
> (read it first for rationale). Grounded in the current server (`packages/server`),
> client (`packages/client`), and the deployed `figure-service`. **v1 boundary:**
> capture → review → persist. **Rendering** committed figures in grade/learn/view-book is
> a separate follow-up and is out of scope here (we persist + expose, we don't render).

## 1. Architecture

One new server endpoint, `POST /api/scan`, orchestrates the read pipeline; a wizard client
drives review; small figure-CRUD endpoints persist crops on commit.

```
            ┌──────────────── POST /api/scan (multipart: images + bookId) ───────────────┐
 client ───▶│  (1) flatten  ──figure-service /v1/process per page─▶ rectified + boxes      │
 wizard     │              ∥                                                                │──▶ { envelope, pages[] }
            │  (2) extract  ──Claude (existing) ─▶ add/edit/skip deltas + figureRefs        │
            │                      └────────────▶ (3) match (Haiku, conditional) ───────────┘
            └─ stage (4) review/edit/confirm is client-side ─────────────────────────────────
 commit ──▶ PUT /api/books/:id/questions (existing) ──▶ ids ──▶ POST /api/questions/:id/figures (crops)
```

- Stages **1 ∥ 2** run concurrently server-side; **3** runs after both, only when there's
  something to match. The single `/api/scan` response carries everything stage 4 needs.
- **Graceful degradation:** stage 2 (problems) is the primary value and is *required*
  (failure → 502, as `/api/extract` today). Stages 1 + 3 (figures) are *best-effort*:
  on failure the response still returns problems, with `figuresError: true` and no boxes,
  so the wizard shows problems and lets the user add figures manually.

## 2. Data model

### 2.1 `Figure` entity (`domain/types.ts`)

```ts
/** A figure crop attached to a question. The crop bytes live in the figure blob store
 *  at imgs/<id>.webp (path derived from id — no separate field). */
export interface Figure {
  id: string;
  customerId: string;        // standard scoping (wrong-owner-is-not-found)
  questionId: string;        // owner; book reachable via the question
  /** Matcher's read of the printed caption ("Figure P5.32"); absent for user-added. */
  printedLabel?: string;
  /** Matcher confidence — enum, matching the spike (not a 0–1 number); absent for user-added. */
  confidence?: 'high' | 'medium' | 'low';
  createdAt: string;
}
```

No `box`/`pageImageId`/`source` (crops-only decision): the persisted artifact is the cut
crop, not a region on a stored page. The crop file is `imgs/<figure.id>.webp`.
**`id` is always a server-minted UUID** (`newId()`), never client-supplied — load-bearing
for the blob path (see §2.2) and serving (§3.5). Multiple figures on one question have no
explicit order field; **display order = `createdAt` ascending** (commit attaches in
reading order, §4.3), and the list endpoint sorts by it.

### 2.2 Store changes (`storage/store.ts`)

- Add a `figures` JSON collection: `JsonCollection.open<Figure>(join(dataDir, 'figures.json'))`,
  exposed as `readonly figures: Repository<Figure>`.
- Add a **figure blob store** (new `storage/figure-blobs.ts`) owning `<dataDir>/imgs/`:

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class FigureBlobs {
  private constructor(private readonly dir: string) {}
  static async open(dataDir: string): Promise<FigureBlobs> { /* mkdir -p imgs/ */ }
  /** Throws on any non-UUID id — id never reaches the filesystem unvalidated (no traversal). */
  path(figureId: string): string;                 // <dir>/<figureId>.webp, after UUID_RE check
  async put(figureId: string, bytes: Buffer): Promise<void>;
  async delete(figureId: string): Promise<void>;  // missing file = no-op
}
```

`path()` rejects any id that isn't a UUID **before** building the filesystem path, so a
crafted `figId` like `../../books` can never escape `imgs/` — defense-in-depth on top of the
route-level scope check (§3.5).

  Constructed in `Store.open` and exposed as `readonly figureBlobs: FigureBlobs`. (Keeps the
  "Store owns the data dir" invariant; swappable for S3 later behind the same two methods.)

## 3. Server components

### 3.1 figure-service client (`services/figure-service-client.ts`)

Wraps `figure-service /v1/process`. Config from env (already used in the cluster):
`FIGURE_SERVICE_URL`, `FIGURE_SERVICE_API_KEY`.

```ts
export interface DetectedFigure { id: number; box: [number, number, number, number]; score: number; }
export interface ProcessResult {
  rectified: { pngBase64: string; width: number; height: number };
  figures: DetectedFigure[];
}
export class FigureServiceError extends Error {}

export interface FigureServiceClient {
  /** POST multipart {file} to /v1/process. Throws FigureServiceError on non-2xx/timeout. */
  process(image: Buffer, mime: ImageMimeType): Promise<ProcessResult>;
}
export function figureServiceFromEnv(env = process.env): FigureServiceClient | null; // null if URL unset
```

- multipart `file` = image bytes; header `X-API-Key: <key>` when set. Timeout ~120 s
  (`AbortController`); on timeout/non-2xx → `FigureServiceError`.
- **Maps the service's snake_case to the client type:** `rectified.png_base64 → pngBase64`
  (the service returns `png_base64`, `width`, `height` — see figure-service README); passes
  `figures[].box`/`score` through; drops `corners`/`cls` (v1 uses boxes).
- Injectable into `/api/scan` for tests (a fake returns canned rectified+boxes).

### 3.2 Extraction contract — add `figureRefs` (`llm/extraction-contract.ts` + `extraction-delta.ts`)

**Prompt** — append to `PROMPT_HEAD` a figure-reference instruction:

```
FIGURE REFERENCES. For each `add` (and `edit`), list in `figureRefs` the figure CAPTION
labels the problem explicitly cites, exactly as printed (e.g. "Figure 5.32", "Fig. 3b").
Read them from the problem text on the page. Use an empty array when the problem cites no
figure. Do NOT invent labels; transcribe only what the problem references.
```

**Schema** — add to `resolved.items.properties`:

```js
figureRefs: { type: 'array', items: { type: 'string' } },
```

**Validator** (`validateDelta`) — carry `figureRefs` on `add`/`edit` (default `[]`),
never on `skip`:

```ts
const figureRefs = Array.isArray(raw.figureRefs)
  ? raw.figureRefs.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
  : [];
```

Add `figureRefs?: string[]` to the `Delta` interface. v1 only *uses* refs from `add`s
(the matcher candidate set); edits carry them harmlessly for forward-compat.

### 3.3 Matcher contract (`llm/matcher-contract.ts`)

A conditional Claude **Haiku 4.5** call (`model: 'claude-haiku-4-5'` — the bare alias the
spike `experiments/figure-matching/match.mjs` proved at 41/42; matches the provider's alias
convention), via the existing `provider.completeStructured` (forced-tool structured output —
the right server path; note the spike used `output_config` JSON-schema instead, a different
mechanism we don't reuse). No `effort`/thinking (Haiku rejects it; the provider doesn't send it).

**Input messages** (one user turn): images = `[rectified page, crop₀, crop₁, …]` (crops cut
server-side from the rectified PNG via **`sharp`** — `sharp(png).extract({left,top,width,
height})` — in detector reading order; `sharp` is a **new server dependency**, the only image
lib in `packages/server`, and a prerequisite of task 5) + a text block:

```
You are matching detected FIGURES to PROBLEMS on one textbook page.
PROBLEMS (index: label — cites figures):
  0: 5.32 — [Figure 5.32]
  1: 5.32 — [Figure 5.32b]   ← labels may repeat; always answer with the INDEX
  2: 5.33 — []
FIGURES: there are N crops, in reading order, indices 0..N-1. For each figure, read its
printed caption off the PAGE image and assign it to the ONE problem INDEX it belongs to
(0..M-1), or null if it belongs to none of the listed problems. Reading order is the
tiebreaker for unlabeled or split (a)/(b) panels. Do not output coordinates.
```

Referencing problems by **index** (not label) is deliberate: the extraction prompt allows
several problems under one path, so labels aren't unique — an index is unambiguous.

**Output schema / result:**

```ts
export interface FigureMatch {
  figureIndex: number;                          // 0-based into the crops sent
  printedLabel: string;                         // caption read off the page ("" if none)
  matchedProblemIndex: number | null;           // index into the candidate add list, or null
  confidence: 'high' | 'medium' | 'low';        // enum (matches the spike's schema, not a number)
}
export interface MatchResult { matches: FigureMatch[]; }
```

`matchedProblemIndex` is an **index into the candidate `add` list presented in the prompt**
(not a label — labels can repeat). `confidence` is an **enum** (`high`/`medium`/`low`),
consistent with the proven spike schema and with `Figure.confidence` (§2.1) — the prompt,
JSON schema, and validator all use the enum; do **not** mix the spike's enum prompt with a
numeric schema (the model would emit strings and every value would be dropped).

**Validator** — `figureIndex` in `[0,N)`; `matchedProblemIndex` in `[0,M)` or `null`, where
**M = the candidate count (`addsWithRefs.length`)**, NOT `resolved.length` (using the wrong M
under-guards the bound and the `addsWithRefs[k].i` remap can go out of range);
`confidence ∈ {high,medium,low}` (else drop the match); extra/missing entries tolerated
(unlisted figures → unmatched). The route then maps the candidate-list index back to the
resolved-array index before responding. **The index is the join key; `printedLabel` is
display-only and is never matched on** (so this honors "labels are agent-assigned, no label
namespace").

Pass an explicit `maxTokens` (≈4000 — one small entry per figure) rather than inheriting the
8000 default, so behavior is intentional; truncation surfaces as `matchError` (best-effort).

### 3.4 `POST /api/scan` (`routes/scan.ts`)

Mounted `app.use('/api/scan', scanRouter(provider, store, figureService))`. Reuses
`/api/extract`'s multer config (≤5 images, ≤10 MB), `requireCustomerId`, and `loadExisting`.
The `acceptImages` / `readImages` / `loadExisting` helpers in `extract.ts` aren't exported —
**lift them into a shared module** (`routes/extract-shared.ts` or similar) rather than
duplicating, since `/api/scan` needs the same multipart handling.

```
1. Validate bookId + images (same 400s as extract); load book (404).
2. Run concurrently. The two have ASYMMETRIC failure, so do NOT let one rejection sink the
   other — flatten self-catches; only extract may reject the request:
   A. extract:  buildExtractionPrompt(existing, learningGoal) [+figureRefs instr]
                → completeStructured(extractionEnvelopeSchema)
                → validateExtractionEnvelope  → envelope        (REQUIRED; reject → 502)
   B. flatten:  ( for each image → figureService.process(...) )
                .then(r => ({ pages: r, figuresError: false }))
                .catch(() => ({ pages: [], figuresError: true }))   // NEVER rejects
   const [envelope, flat] = await Promise.all([A, B]);   // B never rejects (self-catch), so Promise.all only rejects via A → 502
3. Match gate: addsWithRefs = envelope.resolved
        .map((d, i) => ({ d, i }))                        // keep the resolved-array INDEX
        .filter(({ d }) => d.kind === 'add' && d.figureRefs?.length);
   allFigures = flat.pages.flatMap(p => p.figures);
   Run matcher ONLY when addsWithRefs.length>0 AND allFigures.length>0:
     - cut a crop per detected figure from its page's rectified PNG (sharp, server-side)
     - matcher(crops in reading order, addsWithRefs presented by candidate-index, rectified
       pages) → matches (each `matchedProblemIndex` is into the candidate list)
     - matcher failure is best-effort: catch → matchError=true, leave figures unmatched.
4. Fold each match onto its detected figure, mapping `matchedProblemIndex` (candidate-list
   index) → the owning `add`'s resolved-array index via `addsWithRefs[k].i`. A figure carries
   { matchedAddIndex: number | null, printedLabel, confidence }.
5. Respond.
```

**Response:**

```ts
interface ScanResponse {
  envelope: ExtractionEnvelope;        // resolved (with figureRefs) + needsSection
  pages: Array<{
    pageIndex: number;
    rectified: { pngBase64: string; width: number; height: number };
    figures: Array<{
      detectionId: number;               // transient detector ordinal — NOT the persisted Figure.id (UUID, minted at commit)
      box: [number,number,number,number]; score: number;
      matchedAddIndex?: number | null;   // index into envelope.resolved, or null = unmatched
      printedLabel?: string;
      confidence?: 'high' | 'medium' | 'low';
    }>;
  }>;
  figuresError?: boolean;              // figure-service unreachable/failed
  matchError?: boolean;               // detection ok, matcher failed
}
```

The client cuts thumbnails from `pages[].rectified` by `figures[].box`, attaches each figure
to the resolved delta at `matchedAddIndex` (**by index, not label**), and computes the
**(!)** marker **per reference** (matching the plan): an `add` shows **(!)** when
`attachedFigures.length < figureRefs.length` — i.e. it cited more figures than got attached,
so a problem citing two figures that received one still flags. Under `figuresError` every
`add`-with-refs flags (no figures available) — expected, not a per-problem match failure.

**`needsSection` / refine.** A section answer doesn't re-detect figures, so refine **reuses
the existing `POST /api/extract/refine`** (returns only the envelope); the client keeps its
`pages[]` and re-renders. **Known v1 limitation:** problems that were under `needsSection`
and become `add`s only after the refine are *not* auto-matched (matching ran over the
initial adds) — they surface with the **(!)** marker for manual add. A `/api/scan/refine`
that re-matches the cached figures is the documented fast-follow if this bites.

### 3.5 Figure CRUD (`routes/figures.ts`)

```
POST   /api/questions/:id/figures        multipart: crop (image/webp) + { printedLabel?, confidence? }
DELETE /api/questions/:id/figures/:figId
GET    /api/questions/:id/figures         → [{ id, url, printedLabel?, confidence? }]  (sorted by createdAt)
GET    /api/figures/:figId/image          → streams imgs/<figId>.webp  (authed, customer-scoped)
```

(The `GET …/figures` *list* has **no v1 caller** — the wizard holds crops in memory and
never re-reads. It's provided for the deferred read side and is covered by a route test;
keep it labeled so its `{id,url,…}` shape isn't re-litigated when rendering lands.)

- **POST:** verify `store.questions.getById(customerId, id)` (404 if not owner); validate
  `confidence` — **drop it if not `∈ {high,medium,low}`** (optional/cosmetic; a bad value
  must not fail a crop upload); `figId = newId()`;
  `figureBlobs.put(figId, cropBytes)` **then** `figures.create(...)`. **Orphan-blob
  rollback:** wrap the create in try/catch — if `figures.create` throws, `await
  figureBlobs.delete(figId)` (best-effort) then rethrow, so a write-blob-then-row failure
  never leaves a file with no row. Returns `{ id, url: '/api/figures/'+figId+'/image', … }`.
  multer single-file, webp only, ≤5 MB.
- **DELETE:** load figure (scoped) → 404 if missing/other-owner; **delete the row first,
  then the blob** — a crash then leaves at worst an orphan blob, never a row pointing at a
  missing file (which would 500 on serve). Blob delete is best-effort (missing = no-op).
- **GET image:** **validate `figId` against the UUID regex first → 400** on miss (never
  touch the FS with raw input); load figure (scoped) → 404 if missing/other-owner;
  `res.sendFile(figureBlobs.path(figId))` with explicit `Content-Type: image/webp` and
  `Cache-Control: private, max-age=31536000, immutable` (**`private`, not `public`** — the
  crop is customer-owned; `public` would let a shared proxy leak it cross-customer). The
  customer-scope check (figure row lookup) runs **before** the file read — that lookup is
  the only thing isolating one customer's crops from another's (blobs are flat in `imgs/`).
- Mount under the existing `resolveCustomer` chain (after `index.ts` line 68) so all four
  are customer-scoped; ensure no `express.static` is ever pointed at `imgs/`.

### 3.6 Cascade & batch-save (`services/cascade.ts`, `routes/questions.ts`)

Figures must die with their question:

- `deleteBookCascade`: after deleting each question, delete its figures + crop files
  (load `figures.getAll(customerId)` filtered by the doomed `questionId`s).
- The batch-save `PUT /api/books/:id/questions` delete path (`plan.deleteIds`,
  `questions.ts:97-103`) must also drop figures for deleted questions — insert the figure
  cleanup in that same `deleteIds` block, alongside the existing attempt deletes.
- Add a `deleteFiguresForQuestions(store, customerId, questionIds)` helper used by both
  paths; it deletes **row first, then blob** (same safety rationale as §3.5 DELETE), awaited
  sequentially (single-writer store — don't race blob deletes against the JSON flush).
- **These are the only two question-deletion paths today** (there is no flat
  `DELETE /api/questions/:id` route — `questions.ts` has only GET `/:id` + the nested
  batch-save). Any new deletion path MUST call `deleteFiguresForQuestions` or figures leak.

## 4. Client (`packages/client`)

The wizard is a port of the mock `docs/mocks/extract-figures.html` into the app's component
framework. **Source of truth for the figure-selection subpage** (box draw/resize, zoom/pan
gestures, `cut()`, detected-figure guides) is that mock — lift its `<script>` logic
near-verbatim into the page module; it already matches the design system.

### 4.1 New page `FigureScanPage` (`pages/FigureScanPage.ts`)

- Launched from a book (stashed `{ files, bookId }` via the existing `photo-transfer`,
  like today's scan). Route `'/figure-scan'`.
- **Step 1 Pictures** — confirm/add/remove pages (mock step 1).
- **Step 2 Extract** — POST `/api/scan` (multipart, XHR upload progress like
  `ScanProblemsPage.postWithProgress`). On response, hold `pages[]` (incl. `rectified`
  base64 → `Image`) **in memory** for the session; render step 3.
- **Step 3 Review** — see §4.2. Subpage draws on the in-memory `rectified` page.

**Porting notes (the mock is scaffolding, not the app):**
- **Wiring (two missing wires):** add a `main.ts` `.on('/figure-scan', …)` route (absent
  today) and a launch site that `stashPhotos({ files, bookId })` → `#/figure-scan` (the
  existing launch in `ProblemsList` hardcodes `#/scan-problems`). `postWithProgress`
  (`ScanProblemsPage.ts`) is directly reusable for the `/api/scan` multipart upload.
- **v1 is a single rectified page:** **drop the mock's Original/Flattened toggle and the
  multi-page page-switcher.** All boxes live in **rectified** pixel space so the commit-time
  cut from `pages[].rectified` is valid — keeping the Original view would cut at the wrong
  coordinates (the mock's `cut()` reads `pages[fig.page][fig.source]`).
- **Decode-gate every `cut()`:** the rectified base64 → `Image` must be **decoded** before
  any cut (thumbnails in §4.2 or the commit bake). Mirror the mock's `await load()` and
  re-cut/re-render thumbnails on decode, or cuts silently produce blank canvases.
- **Drop the mock data scaffolding:** `loadCase` / `buildSelector` / `DATA` (the
  `experiments/figure-matching` path) / `test-sel` exist only because the mock is served
  from the repo root. Seed `pages` / `labels` / `textByLabel` / `figures` from the
  `/api/scan` response instead. The reusable core — `cut`, `ptNat`, `setGeom`, zoom/pan
  (`applyZoom`/`zoomTo`/`updatePinch`), `renderSub` guides, gesture handlers, `[hidden]`
  CSS — ports near-verbatim.

### 4.2 Stage-4 review (per plan "Stage 4 — review & confirm")

Render the `envelope.resolved` as cards in reading order; figures attach to the resolved
delta at each figure's `matchedAddIndex` (by index, not label):

- `add`: editable KaTeX text (tap → textarea), figure thumbnails (cut from the in-memory
  rectified page by box) with edit-box/remove + **+ add image** (subpage), relevance chip,
  path label, accept/reject toggle, **(!)** when an unmatched `figureRef` remains.
- `edit`: before→after, editable *after*, accept/reject — **no figures**.
- `skip`: muted, grouped under an "N already in your book" expander.
- `needsSection`: blocking prompts at top; answering all → `/api/extract/refine` →
  re-render `resolved` (keep `pages[]`). Commit disabled while any prompt is pending. On
  re-render, **discard the pre-refine cards' accept/reject state** and rebuild from the new
  envelope (like the chat flow's `supersedeLiveBubbles`), or stale toggles leak into the
  commit set. **Also drop all `matchedAddIndex`-based figure attachments** — refine returns
  a fresh envelope whose `resolved` array is renumbered, so those indices are now stale;
  pre-refine figures fall back to the **(!)** manual-add path (the documented limitation).

### 4.3 Commit (self-contained — does NOT reuse the EditBook handoff)

Crops live in the wizard's memory, so the wizard commits problems *and* figures itself (the
legacy `SCAN_ACCEPTED_KEY` → EditBookPage handoff can't outlive the crops). It owns the PUT
body order and reads the new ids back **positionally** — never by label/text (labels can
repeat under one path; text is user-editable) and never via the GET (which re-sorts by path,
`questions.ts:65`, breaking the alignment):

```
1. GET /api/books/:bookId/questions → current saved rows. Build the PUT `questions[]`:
   - EVERY existing row kept WITH its `id` (omitting an existing id makes planBatchSave
     DELETE it, losing its attempts AND figures), carrying its **existing relevance**
     through — an omitted relevance CLEARS it server-side (questions.ts:112).
   - accepted `edit` → MUTATE that already-kept row IN PLACE (replace its `{label,
     canonicalText, relevance}`, keep id = targetId). **Never append a second entry** — a
     duplicate id produces two `questionIds` slots, shifting `addSlots` and breaking the
     positional read-back for every add after it.
   - accepted `add`  → a NEW entry `{label, canonicalText, relevance}` (no id), appended.
   - `skip`s need no action (their existing rows are already kept).
   Track addSlots: the index in `questions[]` of each accepted add.
2. PUT /api/books/:bookId/questions { questions } → `saved[]`. The PUT echoes
   orderByIds(plan.questionIds, saved) in INCOMING order, NOT re-sorted (questions.ts:120,
   unlike GET) — so saved[i] is the persisted row for questions[i]. Each add's new id is
   saved[addSlots[k]].id.
3. For each accepted add's figures (in wizard memory): bake the crop (canvas cut at FULL box
   resolution from the in-memory rectified page → toBlob('image/webp', ~0.85)) and
   POST /api/questions/<saved add id>/figures (multipart crop + printedLabel?/confidence?).
4. Navigate back to the book.
```

Crop baking mirrors the mock's `cut()` but at full box resolution (not the 240 px preview)
and outputs **webp** via `toBlob` (the mock uses `toDataURL('image/jpeg')`); Safari <16 may
fall back to PNG — acceptable. Per-figure POST failures surface as a toast ("N figures
couldn't be saved") and do NOT roll back the already-saved problems.

## 5. Errors & retries

| Failure | Behavior |
| --- | --- |
| Extraction (stage 2) | `502` (problems are required), as `/api/extract` today. |
| figure-service unreachable/`5xx`/timeout | best-effort: `figuresError:true`, no boxes; wizard shows problems, manual-add only. |
| Matcher fails | best-effort: `matchError:true`, figures returned unmatched; user attaches manually. |
| Figure CRUD: blob write fails | `500`; row is created only *after* `blobs.put` succeeds (write-blob-then-row), so no row points at a missing file. |
| Figure CRUD: row create fails *after* blob written | catch → `figureBlobs.delete(figId)` (best-effort) → `500`; no orphan blob left behind. |
| Commit: PUT ok but a figure POST fails | per-figure; surface a toast "N figures couldn't be saved", keep the others. Problems are already saved. |

## 6. Config / deploy

- Reuse existing env: `FIGURE_SERVICE_URL`, `FIGURE_SERVICE_API_KEY` (already mounted in the
  cluster from `figure-service-auth`). When `FIGURE_SERVICE_URL` is unset (local dev w/o the
  service), `/api/scan` runs stage 2 only and returns `figuresError:true` — the flow still works.
- New on-disk dir `<QB_DATA_DIR>/imgs/`. Survives restarts (write-through, like the JSON
  collections). No migration: `figures.json` and `imgs/` are created lazily/empty.

## 7. Testing

- **Unit:** `figureRefs` validator (add/edit carry, skip drops, junk filtered); matcher
  validator (index range, label set, confidence clamp, unlisted→unmatched); `FigureBlobs`
  put/path/delete; `figureServiceFromEnv` null-when-unset + multipart/headers.
- **Route (supertest):** `/api/scan` happy path with a fake provider + fake figure-service
  (asserts envelope + pages + match fold-back); match-gate skip (no refs / no figures);
  best-effort degradation (figure-service throws → `figuresError`); figure CRUD
  create/list/delete + image stream + wrong-owner 404; **malformed/`../` figId → 400**
  (no FS touch); orphan-blob rollback on row-create failure; cascade drops figures + blobs
  on book delete and on batch-save question delete.
- **Client:** commit sequence (full-list merge, id resolution, per-figure POST) with mocked
  fetch; (!) computation from `figureRefs` vs attached.

## 8. Implementation order (tasks)

0. **Add `sharp`** to `packages/server` (server-side crop cutting for the matcher; the only
   image lib in the package) — prerequisite for tasks 4–5.
1. **Data model** — `Figure` type; `figures` collection + `FigureBlobs` (with UUID guard) in `Store`.
2. **figure-service client** (snake_case→camelCase map) + env wiring + fake for tests.
3. **`figureRefs`** — prompt + schema + validator + `Delta` type (no behavior change yet).
4. **Matcher contract** — prompt, schema, validator, Haiku call; unit-tested in isolation.
5. **`POST /api/scan`** — orchestration, match gate, response, degradation; route tests.
6. **Figure CRUD + image serving**; cascade + batch-save figure cleanup.
7. **Client wizard** — port mock; steps 1–2 + `/api/scan` wiring.
8. **Stage-4 review** — delta cards + figures + (!) + needsSection.
9. **Commit** — self-contained PUT + crop bake + figure POST.
10. **E2E pass** on a real page; tune matcher prompt against the spike cases.

## 9. Deferred (not v1)

Rendering figures in grade/learn/view-book (read side); figures on `edit`/`skip`; attach/
detach to already-saved questions; post-commit box editing; add-from-original (perspective
warp); `/api/scan/refine` re-match for section-resolved problems.
