# Frontend foundation for `@qb/client` — design

**Date:** 2026-06-10
**Status:** Approved design
**Scope:** Establish a framework-free TypeScript foundation for building the
real client UI from the `docs/mocks/` prototypes. **This session ships the
foundation only — no pages, no visual components.** Page-by-page
implementation follows in later sessions.

## Purpose

The mocks (`docs/mocks/`) are static HTML/CSS/JS prototypes of every screen.
The real client (`packages/client`) is currently a bare Vite + TypeScript
shell with an empty `#app`. Before building pages, we need a documented,
agreed authoring foundation: how a component is written, where CSS lives, how
state is handled, and how pages are routed — so that subsequent page work is
mechanical rather than re-deciding these each time.

The mocks are a **visual reference, not code to port**. We keep their palette
and look/feel but author CSS fresh to best practices.

## Build order (context, not this session's work)

Pages will be implemented one at a time, in this order, each driving out the
components it needs:

1. Landing (library)
2. Add book
3. Manage books
4. Edit book
5. Learn — view question
6. Learn — grading
7. Revisit — view + grading variants

This spec sets up the ground these are built on. None of them are built this
session.

## Stack decisions

### Components are pure functions

Every visual element is authored as a pure function `(props) => HTMLElement`.
No classes, no lifecycle, no shared state inside a component. Most UI is
render-once and never changes after it is shown (cards, capsules, list rows,
titles, past chat messages), so the component layer carries **no reactivity
machinery** — it just builds an element from props and returns it.

Composition is by passing one component's returned element into another (see
the `html` helper below). Lists are `items.map(Component)`.

### The `html` tagged-template helper

The single authoring primitive. A small (~30–40 line) function:

```ts
function html(strings: TemplateStringsArray, ...values: unknown[]): HTMLElement
```

- Parses the static markup **once** and returns the root `HTMLElement` (a real
  live node, not a string).
- An interpolated **`HTMLElement`** — or an **array of elements** — is inserted
  as real nodes. This is what makes components compose:
  `html\`<div>${Card(props)}</div>\``.
- An interpolated **string or number** is inserted as **text** (assigned via
  `textContent` / text nodes), so values are HTML-injection-safe by default.
- It is sugar over `document.createElement`; under the hood it is the same
  fast direct-DOM construction every framework compiles down to.

This is the entire authoring surface. Every component and page is built from
it. The one acknowledged cost: markup inside the backticks is not
type-checked (it is a string until parsed) — acceptable for a hand-built
component library.

### State: manual first, signals only where it fans out

State is any value that can change *after* render where the DOM must change to
match. Handled on a ladder:

1. **Manual / imperative (default).** Hold a reference to the element and
   update it directly (`badge.textContent = ...`). Correct when one or two
   spots react to a change — which covers most of this app.
2. **Signals (escalation only).** When a single value must fan out to several
   DOM spots and manual wiring becomes tedious, adopt
   **`@preact/signals-core`** (~1KB, framework-free): a signal is a value that
   remembers who read it and re-runs exactly the dependent code on change. No
   virtual DOM, no diffing.

Signals are **not adopted this session.** They are added at the page level the
first time a screen's state wiring genuinely warrants it, and not before. The
static component library never imports them.

#### Worked example: the equation card (card-local vs list-level state)

The mock's `problems-list.js` is the proof that this app needs no reactivity
framework — it already does "reactive" equation cards with **purely imperative
DOM updates**. On LaTeX commit it calls `renderLatex(host, latex)` to wipe and
rebuild that one node; on add/delete/reorder it loops the DOM and re-assigns
labels directly. We mirror that, cleaned into our component shape, by splitting
the state by **ownership**:

- **Static structure → a pure component.**
  `EquationCard(props: { label: string; latex: string }) => HTMLElement`
  returns the row markup via `html`. Render-once.
- **Card-local state → imperative listeners the component attaches to its own
  nodes.** The view⇄edit toggle and the re-render-on-commit close over this
  card's own `rendered` / `editor` nodes and update them directly — a direct
  port of the mock's `enterEdit` / `commitEdit` / `renderLatex`. No signals.
- **List-level state → owned by the list / page component, not the card.**
  Ordering, add, delete, and auto-label renumbering live one level up (as
  `initProblemsList` owns `rows[]` and `renumber()` today). This is the spot
  that *could* later escalate to a signal holding the ordered list — but the
  mock shows manual handling is tractable, so we start manual.

The takeaway the doc generalizes from this: decide *who owns* each piece of
changing state (the component instance, or the list/page above it), update it
imperatively at that level, and reach for signals only when a value must fan
out to many spots — which the equation list does not.

#### Shared, non-component logic: `lib/latex.ts`

The LaTeX-segmenting + KaTeX-rendering logic (`splitMath` / `renderLatex` in
the mock) is **identical** across `learn.html`, `grade.html`, and
`problems-list.js`, is pure (`string → DOM`/segments), and the real client will
reuse it everywhere math appears. It is **not** a visual component, so it lives
in `src/lib/latex.ts` alongside `html.ts` — a shared utility, ported from the
mock. (Ported when the first math-bearing page needs it; named here so the
boundary is documented. Not built this session.)

### CSS: co-located per-component + central tokens

- **`src/styles/tokens.css`** — the `:root` palette (purple / orange / green /
  grey ramps) and semantic tokens (`--bg`, `--fg`, `--muted`, `--border`,
  `--surface`, `--revisit` / `--revisit-dark`, `--learn` / `--learn-dark`,
  `--shadow`) ported fresh from `mocks.css`. Same palette, same look/feel.
  Imported once globally. A future re-tint is a one-file change.
- **`src/styles/reset.css`** — base reset ported from the mocks: `box-sizing`,
  full-height `html/body`, base typography, `overscroll-behavior: none`.
- **Per-component CSS, co-located and component-imported** —
  `import './Card.css'` at the top of `Card.ts`. Vite bundles it. Styles live
  next to the component they style; class names stay **stable and semantic**
  (e.g. `.capsule`, `.card`) as befits a shared design system — no CSS-Modules
  hashing. This convention is *documented* this session; the first actual
  component CSS file lands with the landing page.

### Routing: Navigo (hash mode), documented now, installed later

- **Navigo** (~2KB, dependency-free, actively maintained) in **hash mode**
  (`#/landing`, `#/add-book?isbn=…`). Hash routing needs no server fallback
  and works in an installed PWA offline — both of which matter here. Each
  route maps to a page function returning an `HTMLElement` mounted into
  `#app`.
- Chosen because the goal is to **not own router code**; the tiny 1KB hobby
  hash-routers found in research are mostly unmaintained single-author repos,
  whereas Navigo is small *and* maintained with real adoption.
- **Documented now, installed next session** alongside the landing page —
  there is nothing to route until a page exists. The `approach.md` records the
  pick, the rationale, and a short API sketch.
- Fallback noted for posterity: if Navigo ever proves unsuitable, a ~40-line
  hand-rolled hash router is a drop-in replacement.

### Big question lists: deferred

A book may hold hundreds to thousands of questions; the library tops out
around 50 books. The large lists will use **virtualized scroll + search /
filter** (render only on-screen rows, recycle on scroll) — a *page-level*
concern handled when the question-browsing screen is built, not a
component-authoring concern. Each visible row is still just a
`(props) => HTMLElement` component; the virtualizer decides which ones exist.
Explicitly deferred; nothing about it is built or designed this session.

## What this session builds

```
packages/client/
  index.html                  (exists — keep; #app mount point)
  src/
    lib/
      html.ts                 the html`` helper → HTMLElement
      html.test.ts            integration-style tests for the helper
      (latex.ts)              documented boundary; ported with first math page,
                              not built this session
    styles/
      tokens.css              palette + semantic tokens, ported from mocks.css
      reset.css               base reset, ported from mocks.css
    main.ts                   imports tokens.css + reset.css; #app stays empty
docs/
  superpowers/specs/2026-06-10-fe-foundation-design.md   (this spec)
  client/approach.md          living doc of decisions + how to write a
                              component / page
```

### `main.ts` this session

Imports `tokens.css` and `reset.css` so the global styles are in the bundle
and the base look is established. `#app` is intentionally left empty — there
are no pages yet. The existing empty-skeleton comment is replaced with one
noting that page mounting / the router land with the first page.

### `approach.md` — the primary documentation deliverable

The real point of the session. Concise, living. Captures:

- The component model: `(props) => HTMLElement`, composition via `html`.
- The static-first philosophy (why most components carry no reactivity).
- The state ladder (manual → signals; when to escalate).
- The CSS layout (co-located component CSS + central tokens).
- The routing plan (Navigo hash mode; lands with the landing page; API
  sketch).
- The deferred big-list strategy (virtualized scroll + search/filter).
- The **equation card** worked example above (card-local vs list-level state,
  mirroring the mock's imperative approach), and how a page mounts into `#app`.
- The `lib/latex.ts` boundary (shared math rendering, not a component).

This is what makes later page work mechanical.

## Testing

Per the project test strategy (favor high-level integration / e2e tests; avoid
granular unit tests in this small app), the **only** tests this session are for
`html.ts` itself — it is the load-bearing primitive, so it earns direct
coverage:

- text interpolation renders as text (and is injection-safe);
- an interpolated element is inserted as a real node;
- an interpolated array of elements is each inserted;
- the returned value is the expected root `HTMLElement`.

Components and pages get integration tests as they are built in later sessions.

## Out of scope this session

- Any page or visual component (including the landing page).
- Installing Navigo or any router; wiring `#app` mounting.
- Signals / `@preact/signals-core`.
- List virtualization, search, filtering.
- PWA manifest / installability wiring (ported when a page exists to install).
- Any change to the mocks (`docs/mocks/`) — they remain the visual reference.
