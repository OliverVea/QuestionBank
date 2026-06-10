# Frontend Foundation for `@qb/client` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the framework-free TypeScript authoring foundation for `@qb/client` — the `html` tagged-template helper (with tests), the global `tokens.css` + `reset.css` ported from the mocks, a `main.ts` that loads them into an empty `#app`, and the `approach.md` living doc — so subsequent page work is mechanical.

**Architecture:** Components are pure `(props) => HTMLElement` functions composed via a single `html` tagged-template primitive that builds real DOM nodes (no virtual DOM, no reactivity machinery). CSS is split into central tokens/reset (global) plus future co-located per-component files. This session ships only the load-bearing primitive, the global styles, and the documentation — **no pages, no visual components.**

**Tech Stack:** TypeScript, Vite 8 (bundler/dev server), Vitest 4 + jsdom (already installed at the repo root). No new runtime dependencies are installed this session.

---

## Authoritative spec

`docs/superpowers/specs/2026-06-10-fe-foundation-design.md` (commit `94e7835`, **Status: Approved design**). This plan implements exactly its "What this session builds" section and respects its "Out of scope this session" list. If anything here conflicts with that spec, the spec wins.

## Scope guardrails (read before starting)

- **Foundation only. NO pages, NO visual components this round.** The landing page, `EquationCard`, `lib/latex.ts`, Navigo install, and signals are all DEFERRED — *documented* in `approach.md` but NOT built.
- **The mocks (`docs/mocks/`) are a visual reference, not code to port.** Do not modify anything under `docs/mocks/`. Only `tokens.css` / `reset.css` are direct ports of `mocks.css`; author everything else fresh.
- **Only `html.ts` gets tests** — it is the load-bearing primitive. No granular unit tests elsewhere (see the `test-strategy` memory).
- **Pre-v1 workflow:** commit straight to the current branch (`master`/`main`) — no feature branch (see the `no-branches-before-v1` memory).
- **Commit messages:** use `git commit -F <file>` to avoid PowerShell here-string dropping a stray `@` (see the `commit-message-via-file` memory). Each commit step below writes the message to a temp file, commits with `-F`, then removes the file.
- **Do NOT touch** the unrelated pre-existing tree changes: modified `.claude/settings.local.json` and untracked `docs/superpowers/specs/2026-06-10-api-uat-flows.md`. Stage only the files each task names.

## Environment facts (verified)

- Repo root `package.json` already declares `vitest` (^4.1.8), `jsdom` (^29.1.1), `@types/jsdom`, and a `"test": "vitest run"` script. **No test runner needs installing.**
- There is no `vitest.config.ts` yet. Vitest defaults to the `node` environment; `html.ts` needs the DOM, so Task 1 adds a Vitest config selecting the `jsdom` environment scoped to the client package. `tsconfig` in the client already targets the DOM (Vite default), so `HTMLElement` etc. are in-scope for app code.
- `packages/client/package.json` currently has no `test` script and only `vite` as a devDependency. The root `npm test` runs Vitest across the workspace.
- `packages/client/src/main.ts` is the bare skeleton (grabs `#app`, voids it). `packages/client/index.html` has `<div id="app"></div>` and loads `/src/main.ts`.

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `packages/client/vitest.config.ts` | Create | Select the `jsdom` test environment for the client package so DOM-using tests run. |
| `packages/client/src/lib/html.ts` | Create | The `html` tagged-template helper: parse markup once, return the root `HTMLElement`; interpolate elements/arrays as real nodes and strings/numbers as text (injection-safe). The single authoring primitive. |
| `packages/client/src/lib/html.test.ts` | Create | Integration-style tests for `html`: text interpolation (and injection-safety), single-element insertion, array-of-elements insertion, and the returned root type. |
| `packages/client/src/styles/tokens.css` | Create | `:root` brand ramps + semantic tokens, ported fresh from `mocks.css`. Imported once globally. |
| `packages/client/src/styles/reset.css` | Create | Base reset (box-sizing, full-height html/body, base typography, `overscroll-behavior`), ported from `mocks.css`. |
| `packages/client/src/main.ts` | Modify | Import `tokens.css` + `reset.css`; leave `#app` empty; replace the skeleton comment with one noting page mounting / router land with the first page. |
| `packages/client/package.json` | Modify | Add a `"test": "vitest run"` script for the package (optional convenience; root already runs Vitest). |
| `docs/client/approach.md` | Create | The primary deliverable: living doc of the component model, static-first philosophy, state ladder, CSS layout, routing plan, deferred big-list strategy, the equation-card worked example, the `lib/latex.ts` boundary, and how a page mounts into `#app`. |

---

## Task 1: Vitest jsdom environment for the client package

The `html` helper builds DOM nodes, so its tests need a DOM. Vitest defaults to `node`. Add a client-scoped config selecting `jsdom`, and verify the runner is wired before writing any helper code.

**Files:**
- Create: `packages/client/vitest.config.ts`
- Modify: `packages/client/package.json`

- [ ] **Step 1: Create the Vitest config**

Create `packages/client/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // html.ts builds real DOM nodes, so its tests need a browser-like
    // environment. jsdom is already a root devDependency.
    environment: 'jsdom',
  },
});
```

- [ ] **Step 2: Add a package-level test script**

In `packages/client/package.json`, add a `test` script. The `scripts` block becomes:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
```

- [ ] **Step 3: Add a throwaway smoke test to prove the jsdom environment is active**

Create `packages/client/src/lib/env.smoke.test.ts` (temporary — deleted in Step 5):

```ts
import { test, expect } from 'vitest';

test('jsdom environment provides document', () => {
  const el = document.createElement('div');
  el.textContent = 'hi';
  expect(el.textContent).toBe('hi');
});
```

- [ ] **Step 4: Run it to confirm the environment is wired**

Run: `npm --workspace @qb/client run test`
Expected: PASS — 1 test passing. (If it errors with `document is not defined`, the jsdom environment is not being picked up — fix `vitest.config.ts` before continuing.)

- [ ] **Step 5: Delete the smoke test and commit the config**

```bash
rm packages/client/src/lib/env.smoke.test.ts
```

Write the commit message to a file and commit (PowerShell-safe):

```bash
printf '%s\n' 'chore(client): add jsdom vitest environment' > .commitmsg
git add packages/client/vitest.config.ts packages/client/package.json
git commit -F .commitmsg
rm .commitmsg
```

---

## Task 2: The `html` tagged-template helper (TDD)

The single authoring primitive. Tests are written first and must fail before the implementation exists.

**Files:**
- Create: `packages/client/src/lib/html.test.ts`
- Create: `packages/client/src/lib/html.ts`

### Behavior contract (what the tests pin down)

`html(strings, ...values): HTMLElement`

1. Static markup is parsed once; the function returns the **root** `HTMLElement` (the single top-level element of the template).
2. An interpolated **string or number** is inserted as **text** (via a text node / `textContent`), so `<` and `&` in a value do NOT become markup — injection-safe by default.
3. An interpolated **`HTMLElement`** is inserted as that real node (identity preserved — the same object reference appears in the tree).
4. An interpolated **array of `HTMLElement`s** inserts each element, in order, as real nodes.

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/lib/html.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { html } from './html';

describe('html', () => {
  test('returns the root element of the template', () => {
    const el = html`<section class="card"></section>`;
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.tagName).toBe('SECTION');
    expect(el.className).toBe('card');
  });

  test('interpolates a string as text, not markup (injection-safe)', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const el = html`<p>${evil}</p>`;
    // The value is text content, so no <img> element is created.
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toBe(evil);
  });

  test('interpolates a number as text', () => {
    const el = html`<span>${42}</span>`;
    expect(el.textContent).toBe('42');
  });

  test('interpolates an HTMLElement as a real node (identity preserved)', () => {
    const child = html`<b class="inner">hi</b>`;
    const el = html`<div>${child}</div>`;
    // The exact same node object is in the tree.
    expect(el.querySelector('.inner')).toBe(child);
    expect(el.textContent).toBe('hi');
  });

  test('interpolates an array of elements, each as a real node, in order', () => {
    const items = ['a', 'b', 'c'].map((t) => html`<li>${t}</li>`);
    const el = html`<ul>${items}</ul>`;
    const lis = el.querySelectorAll('li');
    expect(lis.length).toBe(3);
    expect([...lis].map((li) => li.textContent)).toEqual(['a', 'b', 'c']);
    // Identity preserved for each.
    expect(lis[0]).toBe(items[0]);
  });

  test('supports multiple interpolations of mixed kinds', () => {
    const name = 'world';
    const badge = html`<em>!</em>`;
    const el = html`<h1>hello ${name}${badge}</h1>`;
    expect(el.tagName).toBe('H1');
    expect(el.querySelector('em')).toBe(badge);
    expect(el.textContent).toBe('hello world!');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --workspace @qb/client run test`
Expected: FAIL — module `./html` cannot be resolved / `html` is not exported.

- [ ] **Step 3: Implement `html.ts`**

Create `packages/client/src/lib/html.ts`. The implementation uses placeholder marker comments for interpolation slots, parses the assembled markup once via a `<template>`, then walks the marker comments and replaces each with the corresponding value as real nodes (elements/arrays) or text (string/number).

```ts
/**
 * The single authoring primitive for @qb/client.
 *
 * Parses the static markup **once** and returns the root `HTMLElement`
 * (a real live node, not a string). It is sugar over the same direct-DOM
 * construction every framework compiles down to.
 *
 * Interpolation rules:
 *  - an `HTMLElement` (or an array of them) is inserted as real node(s),
 *    which is what makes components compose: html`<div>${Card(props)}</div>`;
 *  - a `string` or `number` is inserted as **text**, so values are
 *    HTML-injection-safe by default.
 *
 * The one acknowledged cost: markup inside the backticks is not type-checked
 * (it is a string until parsed) — acceptable for a hand-built component library.
 */
export function html(
  strings: TemplateStringsArray,
  ...values: unknown[]
): HTMLElement {
  // Stitch the static chunks together, marking each interpolation slot with a
  // unique comment node. Comments are inert in HTML parsing and can sit between
  // any elements, so they are a safe, position-stable placeholder.
  let markup = strings[0];
  for (let i = 0; i < values.length; i++) {
    markup += `<!--qb:${i}-->` + strings[i + 1];
  }

  const template = document.createElement('template');
  template.innerHTML = markup.trim();

  const content = template.content;

  // Collect the placeholder comment nodes up front (the walk is read-only;
  // we mutate the tree afterwards).
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_COMMENT);
  const markers: Comment[] = [];
  let current = walker.nextNode();
  while (current) {
    const text = (current as Comment).data;
    if (text.startsWith('qb:')) markers.push(current as Comment);
    current = walker.nextNode();
  }

  // Replace each placeholder with its value's real node(s) or text.
  for (const marker of markers) {
    const index = Number(marker.data.slice('qb:'.length));
    const value = values[index];
    const nodes = toNodes(value);
    marker.replaceWith(...nodes);
  }

  const root = content.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    throw new Error('html`` template must have a single root HTMLElement');
  }
  return root;
}

/** Normalize an interpolated value into the DOM nodes it should become. */
function toNodes(value: unknown): Node[] {
  if (value instanceof Node) return [value];
  if (Array.isArray(value)) return value.flatMap(toNodes);
  // string | number | anything else → text (injection-safe).
  return [document.createTextNode(String(value))];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --workspace @qb/client run test`
Expected: PASS — all tests in `html.test.ts` green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (If `tsc -b` complains about `vitest.config.ts` or test files, that is environment wiring — fix it here before committing; do not weaken the helper's types.)

- [ ] **Step 6: Commit**

```bash
printf '%s\n' 'feat(client): add html tagged-template helper' > .commitmsg
git add packages/client/src/lib/html.ts packages/client/src/lib/html.test.ts
git commit -F .commitmsg
rm .commitmsg
```

---

## Task 3: Global styles — `tokens.css` and `reset.css` (ported from the mocks)

Port the palette and base reset **fresh** from `docs/mocks/mocks.css`. Same tokens, same look/feel. Do not include the screen-specific chrome from the mocks (topbar, gridpad, load-in animations) — those are component/page concerns for later sessions. Only the `:root` tokens go in `tokens.css`; only the base reset goes in `reset.css`.

**Files:**
- Create: `packages/client/src/styles/tokens.css`
- Create: `packages/client/src/styles/reset.css`

- [ ] **Step 1: Create `tokens.css`**

Create `packages/client/src/styles/tokens.css` (ported verbatim-in-spirit from the `:root` block of `docs/mocks/mocks.css`):

```css
/* Design tokens for @qb/client.
   Ported from docs/mocks/mocks.css — same palette, same look/feel.
   Imported once globally (see src/main.ts). A future re-tint is a one-file
   change here: screen/component CSS should use the semantic tokens, not the
   raw ramps. */
:root {
  /* ---- Brand ramps (50 → 900) ----
     Raw palette. Don't reach for these directly in component CSS — use the
     semantic tokens below so a future re-tint is a one-line change here. */
  --purple-50: #fcfafe;  --purple-100: #dcc9f9;
  --purple-400: #862bd4; --purple-500: #591a8f; --purple-600: #300a50;

  --orange-100: #f9ae60; --orange-200: #d4862b;
  --orange-300: #a86920; --orange-400: #7a4b14; --orange-500: #4b2c09;

  --green-50: #5cfdaa;   --green-100: #2bd486;  --green-200: #20a96a;
  --green-300: #178351;

  --grey-50: #edeff0;    --grey-100: #c2c9cc;   --grey-200: #9ba3a8;
  --grey-300: #7b8285;   --grey-400: #595f61;   --grey-600: #191b1c;

  /* ---- Semantic tokens (use THESE in component CSS) ---- */
  --bg: #fff;
  --fg: var(--grey-600);
  --muted: var(--grey-400);
  --border: var(--grey-100);
  --surface: var(--grey-50);   /* subtle filled backgrounds (cards, footers) */

  --revisit: var(--purple-400);       /* purple */
  --revisit-dark: var(--purple-500);
  --learn: var(--green-200);           /* green */
  --learn-dark: var(--green-300);
  /* --orange-* is the book/accent color used by the add/edit + book screens. */

  /* One consistent elevation for raised surfaces (cards, primary buttons).
     Tight blur so it doesn't get clipped by scroll containers; darker tone. */
  --shadow: 0 3px 12px rgba(25, 27, 28, 0.28);
}
```

- [ ] **Step 2: Create `reset.css`**

Create `packages/client/src/styles/reset.css` (the base reset from `mocks.css`, excluding screen chrome):

```css
/* Base reset for @qb/client.
   Ported from docs/mocks/mocks.css. Establishes box model, full-height shell,
   base typography, and disables touch rubber-banding. Imported once globally
   (see src/main.ts). */
* { box-sizing: border-box; }
html, body { height: 100%; }

body {
  margin: 0;
  font-family: system-ui, sans-serif;
  color: var(--fg);
  background: var(--bg);
  /* The app shells own their own scrolling; stop the page itself from
     rubber-band scrolling/bouncing past the content on touch. */
  overscroll-behavior: none;
}
```

- [ ] **Step 3: Commit (styles only — they are wired into `main.ts` in Task 4)**

```bash
printf '%s\n' 'feat(client): port tokens + reset css from mocks' > .commitmsg
git add packages/client/src/styles/tokens.css packages/client/src/styles/reset.css
git commit -F .commitmsg
rm .commitmsg
```

---

## Task 4: Wire global styles into `main.ts`

Import the two stylesheets so they land in the bundle and the base look is established. `#app` stays intentionally empty — there are no pages yet. Replace the bare-skeleton comment with one noting that page mounting / the router land with the first page.

**Files:**
- Modify: `packages/client/src/main.ts`

- [ ] **Step 1: Replace `main.ts` contents**

Replace the entire contents of `packages/client/src/main.ts` with:

```ts
// Global styles: the central palette/tokens and base reset, ported from the
// mocks. Imported here so Vite bundles them and the base look is established
// app-wide. Per-component CSS is co-located and imported by its component.
import './styles/tokens.css';
import './styles/reset.css';

// #app is intentionally empty this session — there are no pages yet. Page
// mounting and the router (Navigo, hash mode) land with the first page; see
// docs/client/approach.md.
const root = document.getElementById('app');
void root;
```

- [ ] **Step 2: Build to verify the imports resolve and bundle**

Run: `npm --workspace @qb/client run build`
Expected: PASS — `tsc -b` clean and `vite build` emits `dist/` including the bundled CSS (Vite reports a `.css` asset). No "failed to resolve import" errors for the two stylesheets.

- [ ] **Step 3: Commit**

```bash
printf '%s\n' 'feat(client): load global tokens + reset styles' > .commitmsg
git add packages/client/src/main.ts
git commit -F .commitmsg
rm .commitmsg
```

---

## Task 5: `docs/client/approach.md` — the primary documentation deliverable

The real point of the session. A concise, living doc that makes later page work mechanical. It records decisions and patterns; it does NOT build anything. Everything it describes beyond what already exists (the `html` helper + global styles) is explicitly framed as **deferred / lands with a later page**.

**Files:**
- Create: `docs/client/approach.md`

- [ ] **Step 1: Create `approach.md`**

Create `docs/client/approach.md` with the following content:

````markdown
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
  `html\`<div>${Card(props)}</div>\``.
- An interpolated **string or number** is inserted as **text**, so values are
  **HTML-injection-safe by default**.
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
````

- [ ] **Step 2: Sanity-check the doc renders**

Read `docs/client/approach.md` back and confirm: no broken code fences, the
equation-card and `latex.ts` sections are flagged as *deferred / not built*, and
the routing section is marked *installed next session*. (No command — this is a
read-through.)

- [ ] **Step 3: Commit**

```bash
printf '%s\n' 'docs(client): add authoring approach living doc' > .commitmsg
git add docs/client/approach.md
git commit -F .commitmsg
rm .commitmsg
```

---

## Final verification

After all tasks, confirm the foundation is sound and the tree is clean of stray files.

- [ ] **Step 1: Full test run**

Run: `npm test`
Expected: PASS — the `html.test.ts` suite green; no other client tests exist this session.

- [ ] **Step 2: Full typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both clean. `vite build` emits a bundled CSS asset (tokens + reset).

- [ ] **Step 3: Confirm scope was respected**

Run: `git status` and `git log --oneline -6`
Expected:
- New/changed files only under `packages/client/{vitest.config.ts,package.json,src/lib/html.ts,src/lib/html.test.ts,src/styles/tokens.css,src/styles/reset.css,src/main.ts}` and `docs/client/approach.md`.
- **No** new files under `docs/mocks/`, and **no** staged changes to `.claude/settings.local.json` or `docs/superpowers/specs/2026-06-10-api-uat-flows.md` (those remain untracked/modified, untouched).
- **No** page or visual-component files (no `src/pages/`, no `EquationCard`, no `lib/latex.ts`), no `navigo` in `package.json`, no `@preact/signals-core` — all deferred.
- 5 new commits (one per task), each scoped to its task's files.

---

## Self-review (spec coverage)

| Spec requirement ("What this session builds") | Task |
|---|---|
| `src/lib/html.ts` — the `html` helper | Task 2 |
| `src/lib/html.test.ts` — integration tests for the helper | Task 2 |
| `src/styles/tokens.css` — ported from mocks | Task 3 |
| `src/styles/reset.css` — ported from mocks | Task 3 |
| `main.ts` imports both stylesheets; `#app` stays empty; comment updated | Task 4 |
| `docs/client/approach.md` — component model, static-first, state ladder, CSS layout, routing plan, deferred big-list, equation-card example, `lib/latex.ts` boundary, page-mount | Task 5 |
| Tests only for `html.ts` (per test strategy) | Task 2 (only test file authored) |
| jsdom test environment so DOM tests run | Task 1 |

| Spec "Out of scope this session" | Honored by |
|---|---|
| Any page / visual component (incl. landing) | No page/component files created; equation card is doc-only example |
| Installing Navigo / wiring `#app` mounting | `main.ts` leaves `#app` empty; Navigo only documented, not in `package.json` |
| Signals / `@preact/signals-core` | Documented as escalation-only; never installed |
| List virtualization / search / filter | Documented as deferred only |
| PWA manifest / installability | Not touched |
| Any change to `docs/mocks/` | Only *read* for porting; final verification asserts no mock changes |
````
