# Foundation Sub-Project — Registration (Manage tab)

**Status:** Approved design (detailed). The first buildable sub-project.
**Date:** 2026-06-06
**Architecture reference:** [2026-06-06-question-bank-architecture.md](./2026-06-06-question-bank-architecture.md)

## Scope

Build the **Manage** tab: getting content into the bank and keeping it correct. This proves out every architectural layer end-to-end — storage (+ backups), the LLM layer (bulk extraction = the structured one-shot case), and the responsive client — so later sub-projects (grading, SRS) slot in on proven ground.

**In scope:** Book / Chapter / Question CRUD; storage layer with in-memory working set, write-through persistence, and backups; bulk LLM question ingestion; responsive Manage UI; the three-tab app shell (Learn/Practice stubbed).

**Out of scope (later sub-projects):** grading (Learn), spaced repetition (Practice), and the Question fields that serve them (`relevance`, `nextReviewDate`) — these are shaped in the data model now but not populated here.

## App shell

Three top-level tabs — **Learn**, **Practice**, **Manage** — anchored to one user goal each (see architecture doc). The shell is built now with all three tabs present; **only Manage is functional**. Learn and Practice are placeholder panels until their sub-projects land.

Tab navigation works identically on PC and mobile (e.g. bottom tab bar on mobile, top/side tabs on PC).

## Data model (this slice)

Populated here: **Book**, **Chapter**, **Question** (with embedded `QuestionSource`). Field definitions are in the architecture doc. `relevance` and `nextReviewDate` exist in the schema but are left null/unset by this sub-project.

## Storage

Per the architecture doc: flat one-file-per-entity-type under `data/`, in-memory working set, write-through on mutation, behind the `Repository<T>` interface; first-class `BackupStore` (create/list/load/delete) covering all JSON + images, with the auto-snapshot retention timer (-1h/-4h/-1d/-1wk). Backup artifacts and images live under `data/.backups/` and `data/images/` (gitignored).

## API (REST)

Resource-oriented, nested where it reads naturally, flat where it doesn't.

```
# Books
GET    /api/books
POST   /api/books
GET    /api/books/:id
GET    /api/books/:id/tree            # book + nested chapters + questions, one request
PATCH  /api/books/:id
DELETE /api/books/:id

# Chapters
GET    /api/books/:bookId/chapters
POST   /api/books/:bookId/chapters
PATCH  /api/chapters/:id
DELETE /api/chapters/:id

# Questions
GET    /api/chapters/:chapterId/questions
POST   /api/chapters/:chapterId/questions          # manual create
PATCH  /api/questions/:id                          # edit canonical LaTeX, label, etc.
DELETE /api/questions/:id

# Bulk LLM ingestion (step 2)
POST   /api/chapters/:chapterId/questions/extract  # upload image/text → LLM → questions committed under the chapter
```

## Manage UI

**Navigation:** master/detail — two-pane on PC, drill-down back-stack on mobile (Books → Book → Chapter → Questions). Pairs with the `/tree` endpoint.

**Create/edit:** start with **inline, lightweight** interactions — inline add-rows for books/chapters/questions, inline expanding editor for fixing a question's LaTeX. Few/no modals. Optimized for rapid entry. *Iterate from here.*

**LaTeX display:**
- No live preview (deliberately — not wanted).
- A **"finished editing" static rendered view**: in read mode a question's LaTeX renders as math; clicking to edit shows the raw source. Toggle between rendered-static and raw-edit, no simultaneous preview pane.
- Rendering is **deferred to P0 polish** (step 3). Steps 1–2 show **raw LaTeX source**. Rendering library: KaTeX (framework-free standard — a render function + stylesheet, no component model); confirm at step 3.

**Bulk extraction interaction:** **extract-and-commit, no review gate.** In a chapter, upload image/text → `POST .../questions/extract` → LLM extracts N questions → created under the chapter immediately. Mistakes are fixed via normal inline editing afterward.

## Build order (within this sub-project)

Each step ends with something observable in the browser (see the working-style loop in `AGENTS.md`). Slice vertically.

1. **Registration** — three-tab shell (Manage functional; Learn/Practice stubbed), storage layer + backups, inline CRUD for books/chapters/questions, **raw LaTeX source shown**.
2. **LLM ingestion** — the `extract` endpoint + the modular LLM layer shelling out to the Claude Code CLI; image/text upload → questions committed under a chapter (extract-and-commit).
3. **P0 polish** — add the static rendered LaTeX view (KaTeX: read-mode rendered / edit-mode raw); general integration and cleanup to call the foundation done.

## Deferred / later-iteration candidates

Captured so they aren't lost — explicitly **not** in the foundation build:

- Dedicated question editor view (richer than inline) and/or live LaTeX preview.
- Extraction review/staging gate before commit (if extraction proves noisy).
- Admin/settings UI for manual backup create/list/load/delete.
- `relevance` editing UI and `learningGoal`-driven behavior (the fields exist; UI comes with later sub-projects that consume them).
