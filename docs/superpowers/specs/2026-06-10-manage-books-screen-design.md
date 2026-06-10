# Manage Books screen — design

**Date:** 2026-06-10
**Status:** Approved design (mock stage)
**Scope:** A new mock screen for managing the library — edit, delete, and
reorder books, one at a time. Mocks only (`docs/mocks/`); the real client
implements the behavior later.

## Purpose

The home screen lists the library but offers no way to remove, edit, or
reorder books — the library-header pencil led nowhere useful. This screen is
the management surface those actions live on.

## Entry point

Reached from the home screen's library-header pencil (`#library-edit` in
`index.html`), which navigates to `manage-books.html`. Back returns to
`index.html`.

## Screen: `manage-books.html` (+ `manage-books.css`)

A separate screen. Reuses the shared `.topbar` and the home `.book` row's
visual language (cover spine + title/author). **Single mode** — no select
mode, no checkboxes, no bulk operations. Every row carries its own per-row
actions.

### Row anatomy

Each book row, left to right:

1. **Drag handle** (leftmost) — the reorder affordance.
2. **Cover spine** — same look as the library list (real cover or colored
   title fallback).
3. **Title / author** — like the home row but without the progress/ready
   stats. Tapping this row body opens the edit screen.
4. **Delete (trash) button** (rightmost) — deletes that one book.

### Interactions

- **Drag handle** → reorder.
- **Tap row body** → open the edit screen for that book.
- **Tap trash** → delete that book (with Undo; see below). Stops the row's edit
  tap so the two don't both fire.

## Reorder

Dragging a row's left-side handle moves it among its siblings; the new order
persists. In the mock this is a DOM reorder; in the real client it is a
persisted order update. This is the book-level sibling of the previously
flagged chapter drag-reorder feature — keep the handle and drag interaction
visually consistent so the two share a pattern when each is built for real.

## Edit: `edit-book.html`

A **separate file** that reuses `add-book.css` and the add-book layout,
pre-populated for the chosen book. Opened by tapping a row.

Fields (all editable):

- **ISBN** — kept, including the look-up shortcut, so the user can re-run a
  lookup to refresh metadata for an existing book.
- **Title** (required — gates Save), **Author**, **Learning goal**.
- **Problems** — the book's ordered problem list (see "Problems model" below),
  replacing the old "Chapters" section.

Differences from add-book:

- Heading reads **Edit book** (not "Add a book").
- Primary button reads **Save changes** (not "Add to library").

## Problems model

**There are no chapters.** A book is a **flat, ordered list of problems**. This
list appears on **both** `add-book.html` and `edit-book.html` (same component),
replacing the former "Chapters" section. The shared behavior lives in a shared
script, `problems-list.js` (lifted out per the mocks' "lift truly-reusable
interactive patterns" rule, like `footer.js`), not duplicated inline.

Each problem has two **required** fields:

- **Label** — e.g. `1.A.3` (read as chapter 1, section A, problem 3), free-form
  text. **Auto unless overridden:** by default it shows the problem's live
  position (1, 2, 3…) and renumbers as problems reorder; typing a custom label
  pins it to that problem and stops auto-numbering; clearing a custom label
  reverts it to the auto-index.
- **LaTeX text** — the problem statement in LaTeX (mixed text + `$…$` / `$$…$$`,
  parsed exactly as `learn.html` does). **Rendered (KaTeX) by default**; tapping
  it swaps to a raw-LaTeX editable text field showing just the source.
  **Enter or blur (click away) commits** the edit into the page's working
  state and returns to the rendered view.

Each problem **row**: left **drag handle** (reorder — same pointer-drag as the
manage-books rows), the label + rendered LaTeX (tap to edit), right **trash**
(delete). An **[+ add problem]** action appends a blank row (auto-label, empty
LaTeX opened in edit mode). Bulk image ingestion is a later feature, not in this
iteration.

### Saving & unsaved-changes guard

- A **Save changes** / **Add to library** button commits the whole form.
- Editing anything marks the page **dirty**; navigating away (Back, close)
  while dirty triggers a **`beforeunload` unsaved-changes warning**. Saving (or
  reverting to a clean state) clears the guard.

## Delete

Tapping a row's trash button:

1. Removes that row immediately.
2. Shows a transient **"Book deleted — Undo"** toast for a few seconds.
3. Undo within the window restores the book (and its order position).

Copy makes clear deletion also removes the book's questions and progress. No
blocking confirm dialog — the Undo window is the safety net. Delete is one book
at a time; there is no multi-select / bulk delete.

## Build order (skeleton-first, navigable-first)

Per `docs/mocks/AGENTS.md`, the first step is always a navigable skeleton.

1. **Skeleton** *(done)* — bare "Manage library" screen, rows showing a left
   drag handle, cover, title/author, and a right trash button, navigable from
   the home pencil. Edit/delete/reorder are stubbed (`alert`).
2. **Reorder** *(done)* — drag handle moves rows via a pointer-drag with a
   lifted row + placeholder gap.
3. **Edit screen** *(done, evolving)* — `edit-book.html` from the add-book
   layout, pre-populated, opened by a row tap.
4. **Problems model** — drop chapters; build the shared `problems-list.js`
   (label auto/custom, LaTeX render + inline edit, drag-reorder, delete,
   add-row, dirty-guard) and use it on both `add-book.html` and
   `edit-book.html`.
5. **Delete (book)** — wire the manage-books trash to remove the row + show the
   "Book deleted — Undo" toast with restore.

## Out of scope

- Real persistence / API wiring (this is a mock).
- Bulk / multi-select delete (deliberately dropped — one book at a time).
- Chapters and per-problem sections (chapters removed; sections deferred).
- Bulk image ingestion of problems (later feature).
- Adding books (already covered by `add-book.html`).
