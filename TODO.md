# TODO

A dependency-aware task list for the Question Bank. Syntax follows the
[Olve.Diagrams flowchart format](https://github.com/OliverVea/Olve.Diagrams/tree/master):

- Top-level tasks are numbered 1. 2. and so on; sub-tasks are lettered a. b. and indented 2 spaces per level.
- A sub-task's qualified name concatenates its ancestors' ids, so a. under 1. is 1a.
- (done) marks finished work; (blocked) marks work explicitly blocked.
- Trailing brackets are dependencies by qualified name, e.g. [1a] or [3a][4b].
- Descriptions are kept plain ASCII (letters, numbers, minimal punctuation) so the Mermaid renderer doesn't choke.

Paste only the numbered task block below (the task lines, not this prose header) into the
Olve.Diagrams flowchart tool to render it as a Mermaid graph. Each task must be a single line.

---

0. Per customer data segmentation do now before building more BE or UI on top
  a. Introduce a customer id that scopes every data entity book problem attempt and review [1b]
  b. Repository and storage layer reads and writes are filtered by the active customer id [0a]
  c. All routes resolve the active customer id and never leak data across customers [0b]

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

3. Grading polish and robustness
  a. Extraction modal with spinner and true full stack cancel [2d]
  b. Persist the full critique transcript on the Attempt [2c][2f]
  c. (done) Text input extraction modality alongside image [2a]
  d. Extraction review gate before commit if misreads prove noisy [1d]
  e. Do not persist images send them transiently to the LLM and never write them to disk [1d]
    a. Transcribe and extract accept image bytes in request and pass straight to the provider without saving [3e]
    b. Stop writing to the images dir and remove the imagePath field from QuestionSource [3ea]
    c. Attempts record the transcription text only not imagePaths so retranscribe needs the image re uploaded [3eb]
    d. With nothing persisted there is no orphan image cleanup to do [3eb]
  f. Markdown beyond the observed subset such as lists headings and tables [1e]
  g. Edit an earlier chat message and revert the conversation to that point then regrade [2h]

4. Past attempt visibility on the question card
  a. Show past attempts on the question card [2c]
  b. Show a small pass fail history graph like a CI pipeline [4a]

5. Stats and progress
  a. Show book stats in Manage as percent completed [2c]
  b. Show more detailed per book stats [5a]
  c. (done) Record activity in v0 for backwards compatible history attempts and reviews carry createdAt so future stats read real history [2c]

6. Spaced repetition Practice tab
  a. (done) Pure due scheduler one week then one month and only full advances [2c]
  b. (done) ReviewEntry immutable history with derived nextReviewDate on Question [2c]
  c. (done) Due queue and Practice tab UI that surfaces what to review now [6a][6b]
  d. Prioritization function ordering due questions weighted by relevance [6c][7a]
  e. Tune the SRS algorithm once real data exists [6c]

7. Learning goals and relevance
  a. Add a learning goal to a book [1c]
  b. Judge each question relevance to the book learning goal [7a][2a]
  c. Relevance editing UI in Manage [7b]

8. Single screen layout
  a. Page outline is always one screen and anything scrollable is a sub element [1a]
  b. Single screen with a top banner toggling Learn and Practice [2h][6c][8a]
  c. Switch the active book for Learn and Practice with arrows that show only when alternative books exist [8b]

9. Book metadata ingestion
  a. Scrape book title author year and edition from ISBN [1c]
  b. Scan book sections from index pages when ISBN lookup is insufficient [2a][9a]
  c. Take pictures of index or contents pages and have the LLM populate chapters and sections [2a][9b]

10. Backups designed and deferred
  a. JSON BackupStore snapshot and restore all data files [1b]
  b. Auto snapshot retention timer one per age bucket [10a]
  c. Admin UI for manual backup create list load and delete [10a]

11. Provider configuration future
  a. Register LLM provider key and models via UI instead of env only [2a]
  b. Backend abstraction that accepts any LLM provider via a broad multi provider library or an OpenAI compatible gateway maximizing supported providers [2a]
  c. Map the generalized LlmProvider complete and completeStructured and ImageRef contract onto the chosen library so swapping providers needs no app changes [11b]

12. Chapter numbering and reordering future
  a. Explicit chapter numbers [1c]
  b. Drag and drop chapter reordering [12a]

13. Deployment future
  a. Docker image for the server with CLI in container auth as the open catch [1b]

14. Whiteboard solution input
  a. In app whiteboard to draw a solution as an answer modality alongside photo and text [2d]
  b. Endless scrolling canvas so the drawing surface grows as needed [14a]
  c. Zoom in and out on the canvas [14a]
  d. Support rotating the phone 90 degrees to landscape for more room to work [14a]

15. History and revert
  a. Record a change history of edits and deletes across books and problems [1b]
  b. Revert a recorded change to undo it restoring the prior state [15a]
  c. History UI to browse recent changes and revert from there [15b]
  d. Immediate Undo affordance after a destructive action such as delete a book [15b]

16. Flat problems model replacing chapters
  a. A book is a flat ordered list of problems with no chapters [1c]
  b. Each problem has a required label defaulting to its index and editable to a custom value like 1.A.3 [16a]
  c. Problem text is LaTeX rendered by default and edited as raw source committing on enter or blur [16a]
  d. Drag to reorder problems and renumber auto labels [16a]
  e. Edit book screen folds metadata and the problems list with save changes and an unsaved changes guard [16a]

17. Scan to delta problem ingestion v0
  a. Scan or photograph a page of problems and send to the LLM [2a][16a]
  b. LLM generates a delta of updates and additions against the current problems list [17a]
  c. Polish the proposed delta in a conversation before accepting [17b]
  d. Accept applies the delta to the problems list and reject discards it [17c]

18. Dark mode
  a. Define dark theme values for the semantic tokens in the root palette [1a]
  b. Follow the system color scheme by default via prefers color scheme [18a]
  c. Optional manual light dark toggle that overrides the system preference [18b]

19. Session looping through pending content v0
  a. Loop Learn through all available lessons one after another until none remain [2h]
  b. Loop Practice through all due repetitions one after another until none remain [6c]
  c. Track how many lessons and repetitions the user has completed in the current session [19a][19b]
  d. Pause screen at N completed items saying good job and offering a break or continue [19c]
  e. Make the N item pause limit configurable [19d]

20. Streak and goals future
  a. Track a streak of days in a row with practice or learning activity [2c][6c]
  b. Let the user set a cadence goal such as practice every 3 days [20a]
  c. Track whether the user is fulfilling their goal and surface it [20b]
  d. Notifications reminding the user to keep the streak or meet the goal [20c]

