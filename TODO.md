# TODO

A dependency-aware task list for the Question Bank. Syntax follows the
[Olve.Diagrams flowchart format](https://github.com/OliverVea/Olve.Diagrams/tree/master):

- Top-level tasks are numbered `1.`, `2.`, …; sub-tasks are lettered `a.`, `b.`, … and
  **indented 2 spaces per level**.
- A sub-task's **qualified name** concatenates its ancestors' ids: `a.` under `1.` is `1a`.
- `(done)` marks finished work; `(blocked)` marks work explicitly blocked.
- Trailing brackets are **dependencies** (blockers) by qualified name: `[1a]`, `[3][4b]`.
  A task is implicitly blocked while any dependency is unfinished.

Paste any branch of this list into the Olve.Diagrams flowchart tool to render it as a Mermaid graph.

---

1. (done) Foundation — Manage tab (data model, storage, CRUD, ingestion, rendering)
  a. (done) Three-tab app shell (Learn / Practice / Manage); Manage functional, others stubbed
  b. (done) Storage layer — JSON files, in-memory working set, write-through, Repository<T>
  c. (done) Book / Chapter / Question CRUD + inline Manage UI [1b]
  d. (done) LLM layer + bulk image ingestion (extract-and-commit) [1b][1c]
  e. (done) KaTeX rendering — read-mode rendered math/markdown, edit-mode raw [1c]

2. (done) Grading — Learn tab (photo → transcribe → confirm → grade → rate → save)
  a. (done) Generalize LlmProvider to complete/completeStructured + ImageRef; refactor extraction [1d]
  b. (done) Extraction always yields a referenceable label [2a]
  c. (done) Attempt model + repository + POST/GET /api/questions/:id/attempts [1b]
  d. (done) Reusable multi-file image-input component; migrate extraction pane [1d]
  e. (done) Transcribe-only contract + POST /api/questions/:id/transcribe [2a][2d]
  f. (done) Grading contract + stateless POST /api/questions/:id/grade [2a]
  g. (done) Skip/snooze PATCH + learn/next service + GET /api/learn/next [1c]
  h. (done) Learn tab UI — suggested card, navigator, answer/transcribe/confirm/grade view [2c][2e][2f][2g]
  i. (done) LatexEditor component + live KaTeX preview; retranscribe-with-note; cancel [1e][2e][2h]

3. Grading polish & robustness
  a. Extraction modal — spinner + true full-stack cancel (client abort → server abort → no commit) [2d]
  b. Persist the full critique transcript on the Attempt (currently final-state only) [2c][2f]
  c. Text-input extraction modality (extractQuestionsFromText) alongside image [2a]
  d. Extraction review/staging gate before commit (if image misreads prove noisy) [1d]
  e. Orphan-image GC — sweep unreferenced images, deleting any older than ~15m [1d]
    a. Switch image filenames to time-ordered UUIDv7 so creation time is self-describing [1d]
    b. Background timer (~every 15m) runs a mark-and-sweep over <dataDir>/images [3ea]
    c. Mark = union of all references (Question.source.imagePath + Attempt.imagePaths);
       sweep deletes files unreferenced AND older than the 15m grace window [3eb]
    d. Grace window covers the gap between transcribe-time save and attempt-commit;
       deleted-entity leftovers (question/attempt) become unreferenced and are reclaimed too [3ec]
  f. Markdown beyond the observed subset (lists, headings, links, tables) when data needs it [1e]

4. Past-attempt visibility (on the question card)
  a. Show past attempts on the question card [2c]
  b. Show a small pass/fail history graph (like a CI pipeline's run history) [4a]

5. Stats & progress
  a. Show book stats in Manage — % completed / (total − skipped) [2c]
  b. Show more detailed per-book stats [5a]

6. Spaced repetition — Practice tab
  a. Pure due-scheduler — 1 week then 1 month after a passing attempt; only `full` advances [2c]
  b. ReviewEntry history (immutable) + derived nextReviewDate on Question [6a]
  c. Due-queue + Practice tab UI (system tells the user what to review now) [6a][6b]
  d. Prioritization function — order due questions partial > DNM > full, weighted by relevance [6c][7a]
  e. Make the SRS algorithm work better (tune intervals/ordering once real data exists) [6c]

7. Learning goals & relevance
  a. Add a learning goal to a book [1c]
  b. Judge each question's relevance to the book's learning goal (essential/relevant/can-skip/should-skip) [7a][2a]
  c. relevance editing UI in Manage [7b]

8. Single-screen layout
  a. Page outline is always a single screen — no whole-page scroll on desktop or mobile;
     anything scrollable is a sub-element (inner scroll regions, fixed shell) [1a]
  b. Reduce to a single screen — top banner toggles LEARN (next on list) / PRACTICE (due, by relevance) [2h][6c][8a]

9. Book metadata ingestion
  a. Scrape book title / author / year / edition (and maybe index, contents, questions) from ISBN [1c]
  b. Scan book sections from index page(s) when ISBN lookup is insufficient [2a][9a]

10. Backups (BackupStore — designed, deferred)
  a. JSON BackupStore — snapshot/restore all data files + images [1b]
  b. Auto-snapshot retention timer — one per age bucket (-1h / -4h / -1d / -1wk) [10a]
  c. Admin/settings UI for manual backup create/list/load/delete [10a]

11. Provider configuration (future)
  a. Register LLM provider / key / model(s) via UI/API instead of env-only [2a]

12. Chapter numbering & reordering (future)
  a. Explicit chapter numbers [1c]
  b. Drag-and-drop chapter reordering [12a]

13. Deployment (future)
  a. Docker image for the server (CLI-in-container auth is the open catch) [2]
