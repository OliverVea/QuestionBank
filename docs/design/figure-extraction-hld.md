# Figure extraction — HLD (draft, top section)

> **Status:** Draft · top-of-HLD only (framing, flow, components, decisions, scope).
> Data model, API contracts, and the per-component design are **deferred** — we are
> not ready for a spec yet. Grounded in `docs/investigations/figure-extraction.md`
> (research) and the `experiments/figure-matching/` spike (model bake-off).

## Context

A user photographs a textbook page. We want to turn that page into structured
**problems** (questions), and attach the **figures** each problem references, so the
problems render with their diagrams. The "image half" — dewarp + figure detection —
already runs as the deployed `figure-service`. This HLD covers how question
extraction, figure extraction, and figure→problem matching compose into one flow, and
how the user reviews and corrects the result.

## Goals (v1)

- From one page photo, produce problems (KaTeX/markdown content) and attach the
  correct figure image to each problem that references one.
- Keep the user in control: review, add, edit, and remove figures per problem.
- Be cheap enough to iterate and tune freely (matching is ~4¢ per 6 pages today).

## Non-goals / deferred

- **Tables.** Represented as inline LaTeX in problem content — no detection, no crop,
  no matching. (Decision: scope to figures; tables come later if ever.)
- **Add-figure from the *original* (un-dewarped) photo.** v1 supports adding from the
  **rectified** image only; the original-image path needs a 4-point perspective warp
  and is a phase-2 feature.
- **Free-dragging figure corners.** v1 adds/edits figures as **rectangles** on the
  rectified page; dragging the four corners independently (a perspective quad) is v2.
- Caption detection / figure↔caption pairing in the service (see Decisions — we don't
  have caption spatial data and aren't adding it for v1).

## High-level flow

1. **Capture** — user takes a picture of the page.
2. **Extract problems** *(Claude, vision)* — the page → problems in reading order:
   each problem has its number/label, content (KaTeX/markdown), and a list of
   **figure references** (`label`) it mentions. Runs concurrently with (3).
3. **Extract figures** *(figure-service)* — the same image → dewarped page + figure
   crops, in reading order (top-to-bottom, left-to-right). Concurrent with (2).
4. **Match** *(Claude, vision — conditional)* — only if (2) produced figure
   references: assign each extracted figure to the problem it belongs to.
5. **Review & edit** — present problems with their attached figures. The user can
   add / edit / remove figures per problem. A figure **is a box (pixel coords) on the
   rectified page**; the client cuts the crop from the page for display. Adding a
   figure = **draw / manage a rectangle** on the rectified page (v1); free-dragging the
   four corners independently is a v2 refinement.

Steps 2 and 3 are independent and run in parallel; the UI can render problems as soon
as (2) returns and attach figures when (3)+(4) complete (progressive).

## Components

- **Problem extraction** — Claude vision call. Emits problems in order with content +
  figure references. (The reference `label` is the join key the matcher targets.)
- **figure-service** — already deployed (UVDoc dewarp + DocLayout-YOLO figure
  detection). Returns the **rectified page image + figure boxes (pixel coords)** in
  reading order — **no crop images**; the client cuts crops from the page. Figures
  only; captions/tables are dropped.
- **Matcher** — Claude vision call (see below). Conditional on (2) having references.

## Key design decisions

- **Matcher model: Claude Haiku 4.5.** Bake-off on a 6-page / 42-figure spike:
  Haiku 41/42, Sonnet 4.6 42/42, Opus 4.8 39/42 (Opus over-thought ambiguous panels).
  Haiku at ~4¢/6pp leaves a large tuning budget; Sonnet-lean is the fallback if
  faint-figure accuracy matters. See [[figure-matching-model-choice]].
- **Matcher input = figure crops (in order) + problems-with-references (in order) +
  the rectified page.** The matcher reads each figure's printed caption **visually off
  the page** (the caption text lives *outside* the figure box, so it is not in the
  crop). References constrain the target label set; **reading order is the one
  structured prior** and acts as the tiebreaker, especially for unlabeled or split
  `(a)/(b)` figures.
- **Boxes are the interface, both directions** — a figure *is* a box in rectified
  pixel coords. The service emits boxes (not crop images); the client cuts the figure
  out of the page, and the user manages figures as boxes too. **But no boxes in the
  matcher prompt:** a VLM can't precisely consume pixel coords and already locates
  figures visually, so boxes stay out of the model call — used only client-side for
  cropping/rendering.
- **No caption geometry.** We don't have caption spatial data and aren't adding it;
  caption reading stays a visual task over the page.
- **Lean structured output.** Bare question labels + per-figure
  `printed_label` / `matched_question_label` / `confidence`; no prose reasoning, no
  `effort`/thinking (Haiku rejects `effort`). This cut matcher output tokens ~86%.
- **Figures are persisted.** Extracted crops are stored and attached to problems —
  this is a deliberate reversal of the current "images are never persisted" policy
  (the single decision that must be settled before build).

## Known risks / watch-items

- **Faint / low-contrast figures** — Haiku's one spike miss; the place to harden
  (e.g. higher `imgsz`, or Sonnet fallback).
- **Composite figures split into `(a)/(b)` panels** by the detector — produces
  orphaned panels with no single caption; the hardest matching case.
- **Persistence reversal** — storing crops contradicts current policy; needs sign-off
  plus a storage decision (where crops live, how a Problem references them).

## Next

A clickable **mock of the capture → extract → review/edit flow** (in `docs/mocks/`,
on the shared scaffold), to pin the UX before any spec or build.
