# DONE

Completed work archived out of [TODO.md](TODO.md). Same dependency-aware
[Olve.Diagrams flowchart format](https://github.com/OliverVea/Olve.Diagrams/tree/master)
as TODO.md. Open tasks in TODO.md still reference these by qualified name
(e.g. [2c], [16a]) as dependencies, so keep the ids stable here.

---

0. (done) Per customer data segmentation do now before building more BE or UI on top
  a. (done) Introduce a customer id that scopes every data entity book problem attempt and review [1b]
  b. (done) Repository and storage layer reads and writes are filtered by the active customer id [0a]
  c. (done) All routes resolve the active customer id and never leak data across customers [0b]

1. (done) Foundation Manage tab
  a. (done) Three tab app shell with Manage functional and others stubbed
  b. (done) Storage layer JSON files in memory working set write through repository
  c. (done) Book chapter question CRUD with inline Manage UI [1b]
  d. (done) LLM layer and bulk image ingestion extract and commit [1b][1c]
  e. (done) KaTeX rendering read mode rendered math edit mode raw [1c]

2. (done) Grading Learn tab photo to transcribe to confirm to grade to rate to save
  a. (done) Generalize LlmProvider to complete and completeStructured with ImageRef [1d]
  b. (done) Extraction always yields a referenceable label [2a]
  c. (done) Attempt model and repository with attempts routes [1b]
  d. (done) Reusable multi file image input component migrate extraction pane [1d]
  e. (done) Transcribe only contract and transcribe route [2a][2d]
  f. (done) Grading contract and stateless grade route [2a]
  g. (done) Skip and snooze PATCH plus learn next service and route [1c]
  h. (done) Learn tab UI suggested card navigator and grade view [2c][2e][2f][2g]
  i. (done) LatexEditor component with live preview retranscribe and cancel [1e][2e][2h]

3e. (done) Do not persist images send them transiently to the LLM and never write them to disk [1d]
  a. (done) Transcribe and extract accept image bytes in request and pass straight to the provider without saving [3e]
  b. (done) Stop writing to the images dir and remove the imagePath field from QuestionSource [3ea]
  c. (done) Attempts record the transcription text only not imagePaths so retranscribe needs the image re uploaded [3eb]
  d. (done) With nothing persisted there is no orphan image cleanup to do [3eb]

3c. (done) Text input extraction modality alongside image [2a]

4. (done) Past attempt visibility on the question card
  a. (done) Show past attempts on the question card book view rows link to the attempts subpage [2c]
  b. (done) Show a small pass fail history graph like a CI pipeline CiStrip on each problem row [4a]

5. (done) Stats and progress (per book progress is surfaced on the landing library via BookCard not the Manage tab; 5b more detailed stats remains open in TODO.md)
  a. (done) Show book stats as percent completed [2c]
    a. (done) Library list API view with derived per book progress percent and ready count GET books summaries [5a]

5c. (done) Record activity in v0 for backwards compatible history attempts and reviews carry createdAt so future stats read real history [2c]

6. (done) Spaced repetition Practice tab core
  a. (done) Pure due scheduler one week then one month and only full advances [2c]
  b. (done) ReviewEntry immutable history with derived nextReviewDate on Question [2c]
  c. (done) Due queue and Practice tab UI that surfaces what to review now [6a][6b]

8. (done) Single screen layout
  a. (done) Page outline is always one screen and anything scrollable is a sub element [1a]
  b. (done) Single screen with a top banner toggling Learn and Practice [2h][6c][8a]
  c. (done) Switch the active book for Learn and Practice with arrows that show only when alternative books exist [8b]

16. (done) Flat problems model replacing chapters
  a. (done) A book is a flat ordered list of problems with no chapters [1c]
  b. (done) Each problem has a required label defaulting to its index and editable to a custom value like 1.A.3 [16a]
  c. (done) Problem text is LaTeX rendered by default and edited as raw source committing on enter or blur [16a]
  e. (done) Edit book screen folds metadata and the problems list with save changes and an unsaved changes guard [16a]

17. (done) Scan to delta problem ingestion v0
  a. (done) Scan or photograph a page of problems and send to the LLM [2a][16a]
  b. (done) LLM generates a delta of updates and additions against the current problems list [17a]
  c. (done) Polish the proposed delta in a conversation before accepting [17b]
  d. (done) Accept applies the delta to the problems list and reject discards it [17c]

19. (done) Session looping through pending content v0
  a. (done) Loop Learn through all available lessons one after another until none remain [2h]
  b. (done) Loop Practice through all due repetitions one after another until none remain [6c]
  c. (done) Track how many lessons and repetitions the user has completed in the current session [19a][19b]
  d. (done) Pause screen at N completed items saying good job and offering a break or continue [19c]
  e. (done) Make the N item pause limit configurable [19d]

20. Streak and goals future (20d notifications remains open in TODO.md)
  a. (done) Track a streak of days in a row with practice or learning activity [2c][6c]
  b. (done) Let the user set a cadence goal such as practice every 3 days [20a]
  c. (done) Track whether the user is fulfilling their goal and surface it [20b]
