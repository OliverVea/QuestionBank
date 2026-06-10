# `@qb/client` — authoring approach

A living doc of how the QuestionBank client is built. Read this before adding a
page or component. It captures the decisions agreed in
`docs/superpowers/specs/2026-06-10-fe-foundation-design.md`; if the two ever
disagree, treat that spec as the historical record and update this doc to match
current practice.

The mocks under `docs/mocks/` are the **visual reference** — palette, look, and
feel. They are not code to port (except the tokens/reset, which were).

## What exists today (the foundation)

- **`src/lib/html.ts`** — the one authoring primitive (below).
- **`src/styles/tokens.css` + `src/styles/reset.css`** — global palette/tokens
  and base reset, ported from the mocks, imported once in `src/main.ts`.
- **`src/main.ts`** — loads the global styles; `#app` is empty. Page mounting
  and the router land with the first page.

Everything else in this doc (pages, components, `lib/latex.ts`, the router,
signals, virtualization) is **documented here but not yet built** — it lands with
the page that first needs it.

## The component model: `(props) => HTMLElement`

Every visual element is a **pure function** `(props) => HTMLElement`. No classes,
no lifecycle, no shared state inside a component. Most UI is render-once and
never changes after it is shown (cards, capsules, list rows, titles, past chat
messages), so the component layer carries **no reactivity machinery** — it just
builds an element from props and returns it.

Composition is by passing one component's returned element into another. Lists
are `items.map(Component)`.

```ts
function Capsule(props: { label: string }): HTMLElement {
  return html`<span class="capsule">${props.label}</span>`;
}

function Toolbar(props: { labels: string[] }): HTMLElement {
  return html`<div class="toolbar">${props.labels.map((l) => Capsule({ label: l }))}</div>`;
}
```

## The `html` helper

The single authoring surface (`src/lib/html.ts`, ~40 lines):

```ts
function html(strings: TemplateStringsArray, ...values: unknown[]): HTMLElement
```

- Parses the static markup **once** and returns the root `HTMLElement` (a real
  live node, not a string).
- An interpolated **`HTMLElement`** — or an **array of elements** — is inserted
  as real nodes. This is what makes components compose:
  `` html`<div>${Card(props)}</div>` ``.
- An interpolated **string or number** is inserted as **text**, so values are
  **HTML-injection-safe by default**.
- `null`, `undefined`, and `false` render **nothing**, so the natural
  conditional `` html`<div>${show && Badge()}</div>` `` is safe (no stray `"false"`
  text).
- It is sugar over `document.createElement`; under the hood it is the same fast
  direct-DOM construction every framework compiles down to.

The one acknowledged cost: markup inside the backticks is not type-checked (it is
a string until parsed). Acceptable for a hand-built component library. The helper
itself is the only thing with direct unit tests (`html.test.ts`) — it is
load-bearing, so it earns coverage.

## State: manual first, signals only where it fans out

State is any value that can change *after* render where the DOM must change to
match. Handle it on a ladder:

1. **Manual / imperative (default).** Hold a reference to the element and update
   it directly (`badge.textContent = ...`). Correct when one or two spots react
   to a change — which covers most of this app.
2. **Signals (escalation only).** When a single value must fan out to several DOM
   spots and manual wiring becomes tedious, adopt **`@preact/signals-core`**
   (~1KB, framework-free): a signal remembers who read it and re-runs exactly the
   dependent code on change. No virtual DOM, no diffing.

Signals are **not installed yet.** They are added at the page level the first
time a screen's state wiring genuinely warrants it, and not before. The static
component library never imports them.

### Worked example: the equation card (card-local vs list-level state)

The mock's `problems-list.js` proves this app needs no reactivity framework — it
already does "reactive" equation cards with **purely imperative DOM updates**. On
LaTeX commit it calls `renderLatex(host, latex)` to wipe and rebuild that one
node; on add/delete/reorder it loops the DOM and re-assigns labels directly. We
mirror that, cleaned into our component shape, by splitting state by
**ownership**:

- **Static structure → a pure component.**
  `EquationCard(props: { label: string; latex: string }) => HTMLElement` returns
  the row markup via `html`. Render-once.
- **Card-local state → imperative listeners the component attaches to its own
  nodes.** The view⇄edit toggle and the re-render-on-commit close over this
  card's own `rendered` / `editor` nodes and update them directly — a direct port
  of the mock's `enterEdit` / `commitEdit` / `renderLatex`. No signals.
- **List-level state → owned by the list / page component, not the card.**
  Ordering, add, delete, and auto-label renumbering live one level up (as
  `initProblemsList` owns `rows[]` and `renumber()` today). This is the spot that
  *could* later escalate to a signal holding the ordered list — but the mock shows
  manual handling is tractable, so we start manual.

**Generalized rule:** decide *who owns* each piece of changing state (the
component instance, or the list/page above it), update it imperatively at that
level, and reach for signals only when a value must fan out to many spots — which
the equation list does not.

> `EquationCard` is an **illustrative example here, not a build target.** It is
> built when the edit-book / problems page is built.

## Shared, non-component logic: `lib/latex.ts`

The LaTeX-segmenting + KaTeX-rendering logic (`splitMath` / `renderLatex` in the
mock) is **identical** across `learn.html`, `grade.html`, and `problems-list.js`,
is pure (`string → DOM`/segments), and the real client reuses it everywhere math
appears. It is **not** a visual component, so it lives in `src/lib/latex.ts`
alongside `html.ts` — a shared utility, ported from the mock.

Ported when the first math-bearing page needs it; named here so the boundary is
documented. **Not built yet.**

## CSS: co-located per-component + central tokens

- **`src/styles/tokens.css`** — the `:root` palette and semantic tokens
  (`--bg`, `--fg`, `--muted`, `--border`, `--surface`, `--revisit`/`-dark`,
  `--learn`/`-dark`, `--shadow`). Imported once globally. Use the **semantic
  tokens** in component CSS, not the raw ramps, so a re-tint is one file.
- **`src/styles/reset.css`** — base reset (box model, full-height shell, base
  typography, `overscroll-behavior: none`). Imported once globally.
- **Per-component CSS, co-located and component-imported** — `import './Card.css'`
  at the top of `Card.ts`. Vite bundles it. Styles live next to the component
  they style; class names stay **stable and semantic** (e.g. `.capsule`, `.card`)
  as befits a shared design system — no CSS-Modules hashing. The first actual
  component CSS file lands with the landing page.

## Routing: Navigo (hash mode) — documented now, installed with the first page

- **Navigo** (~2KB, dependency-free, actively maintained) in **hash mode**
  (`#/landing`, `#/add-book?isbn=…`). Hash routing needs no server fallback and
  works in an installed PWA offline — both of which matter here. Each route maps
  to a page function returning an `HTMLElement` mounted into `#app`.
- Chosen because the goal is to **not own router code**; the tiny hobby
  hash-routers found in research are mostly unmaintained, whereas Navigo is small
  *and* maintained with real adoption.
- **Installed next session** alongside the landing page — there is nothing to
  route until a page exists.

API sketch (for when it lands):

```ts
import Navigo from 'navigo';

const app = document.getElementById('app')!;
const router = new Navigo('/', { hash: true });

function mount(page: () => HTMLElement) {
  app.replaceChildren(page());
}

router
  .on('/landing', () => mount(LandingPage))
  .on('/add-book', (match) => mount(() => AddBookPage(match?.params)))
  .resolve();
```

**Fallback for posterity:** if Navigo ever proves unsuitable, a ~40-line
hand-rolled hash router is a drop-in replacement.

## How a page mounts into `#app`

A page is a `() => HTMLElement` (optionally taking route params). The router
swaps the current page out of `#app` and the new one in, e.g. via
`app.replaceChildren(page())` (shown above). `main.ts` currently leaves `#app`
empty; the router takes over `#app` when the first page lands.

## Big question lists: deferred

A book may hold hundreds to thousands of questions; the library tops out around
50 books. Large lists will use **virtualized scroll + search / filter** (render
only on-screen rows, recycle on scroll) — a *page-level* concern handled when the
question-browsing screen is built, not a component-authoring concern. Each
visible row is still just a `(props) => HTMLElement` component; the virtualizer
decides which ones exist. **Explicitly deferred; nothing about it is built yet.**

## Build order (context)

Pages are implemented one at a time, each driving out the components it needs:

1. Landing (library)
2. Add book
3. Manage books
4. Edit book
5. Learn — view question
6. Learn — grading
7. Revisit — view + grading variants
