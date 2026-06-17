# TODO

A dependency-aware task list for the Question Bank. Syntax follows the
[Olve.Diagrams flowchart format](https://github.com/OliverVea/Olve.Diagrams/tree/master):

- Top-level tasks are numbered 1. 2. and so on; sub-tasks are lettered a. b. and indented 2 spaces per level.
- A sub-task's qualified name concatenates its ancestors' ids, so a. under 1. is 1a.
- (done) marks finished work; (blocked) marks work explicitly blocked.
- Trailing brackets are dependencies by qualified name, e.g. [1a] or [3a][4b].
- Descriptions are kept plain ASCII (letters, numbers, minimal punctuation) so the Mermaid renderer doesn't choke.

Completed work lives in [DONE.md](DONE.md). Dependency brackets below may point at
ids archived there (e.g. [2c], [16a]); those ids stay stable in DONE.md.

Paste only the numbered task block below (the task lines, not this prose header) into the
Olve.Diagrams flowchart tool to render it as a Mermaid graph. Each task must be a single line.

---

3. Grading polish and robustness
  a. Extraction modal with spinner and true full stack cancel [2d]
  b. Persist the full critique transcript on the Attempt [2c][2f]
  d. Extraction review gate before commit if misreads prove noisy [1d]
  f. Markdown beyond the observed subset such as lists headings and tables [1e]
  g. Edit an earlier chat message and revert the conversation to that point then regrade [2h]

4. Past attempt visibility on the question card
  a. Show past attempts on the question card [2c]
  b. Show a small pass fail history graph like a CI pipeline [4a]

5. Stats and progress
  a. Show book stats in Manage as percent completed [2c]
    a. Library list API view with derived per book progress percent and ready count GET books view library deferred from the flat problems v0 [5a]
  b. Show more detailed per book stats [5a]

6. Spaced repetition Practice tab tuning
  d. Prioritization function ordering due questions weighted by relevance [6c][7a]
  e. Tune the SRS algorithm once real data exists [6c]

7. Learning goals and relevance
  a. Add a learning goal to a book [1c]
  b. (done) Judge each question relevance to the book learning goal high medium low stored on Question and set by extraction [7a][2a]
  c. (done) Relevance editing UI in the Edit book problems list [7b]
  d. (done) Postpone low relevance questions in Learn ordering so they only surface once higher relevance questions in the book are attempted Practice due ordering keeps SRS urgency unchanged [7c][6c]

8. Single screen layout
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

12. (blocked) Chapter numbering and reordering future superseded by the flat problems model 16 chapters are gone
  a. (blocked) Explicit chapter numbers [1c]
  b. (blocked) Drag and drop chapter reordering [12a]

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
  d. (blocked) Drag to reorder problems and renumber auto labels superseded by derived path ordering server owns order from the label path [16a]

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
  d. Notifications reminding the user to keep the streak or meet the goal [20c]

21. Accessibility
  a. Keyboard navigation model for all interactive screens including grade chat [8a]
  b. Screen reader announcements for state changes such as grade result and new chat turns [2h][6c]
  c. Focus management when switching screens via the router [8b]
  d. Ensure all interactive elements have visible focus indicators [1a]

22. Offline mode
  a. Service worker caching the app shell and KaTeX assets for full offline launch [13a]
  b. Pre-cache question data for the next session worth of due items so Learn and Practice work offline [6c][2h]
  c. Degrade gracefully to self-grading when LLM is unreachable showing question then self-rate [2h]
  d. Queue photographed solutions locally for batch grading when connectivity returns [22c]
  e. Optionally pre-fetch LLM solution sketches for due questions to enable offline answer reveals [22b]
