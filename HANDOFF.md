# Self-Igniting Letter — build the landing (library) page for `@qb/client`

**Read this once, then delete it immediately (`rm HANDOFF.md`) before doing anything else.** This file is ephemeral context, not documentation — it should not outlive the read.

## What the user is trying to do

Build the **landing (library) page** — the first real page of `@qb/client` —
from the `docs/mocks/index.html` prototype. This is the first page in the build
order; it drives out the components, the router install, and `lib/latex.ts` is
NOT needed yet (no math on this screen).

## Current state

Nothing running. No background tasks, no builds in flight. Clean stopping point.
`master` is fully synced with `origin/master` (0 ahead / 0 behind). The FE
**foundation** is done, committed, and pushed — your job builds the first page
on top of it.

## Verify this first

```bash
git log --oneline -3                 # HEAD should be face9b7 docs(plan): FE foundation implementation plan
npm run test:client                  # expect 8/8 pass (the html helper, jsdom project)
npm run build                        # tsc -b + vite build clean; emits a bundled CSS asset
```

A "good" result: 8 client tests green, build clean. Then read these two before
writing any code — they are authoritative:
- `docs/client/approach.md` — HOW to build (component model, `html` helper,
  state ladder, CSS co-location, the Navigo router sketch, how a page mounts).
- `docs/superpowers/specs/2026-06-10-fe-foundation-design.md` — the build order
  and what was deliberately deferred to "the first page" (i.e. now).

## What's been done (foundation — all pushed)

- `098068b` + `7a200d6` — `src/lib/html.ts`, the authoring primitive. Use it for
  ALL markup. Composes elements/arrays as real nodes; strings/numbers are
  injection-safe text; `null`/`undefined`/`false` render nothing (so
  `${cond && El()}` is safe). 8 tests in `tests/unit/lib/html.test.ts`.
- `f638dd9` + `855b778` — `src/styles/tokens.css` + `reset.css`, imported in
  `src/main.ts`. The palette is already global; **use the semantic tokens**
  (`--bg`, `--fg`, `--muted`, `--revisit`/`-dark`, `--learn`/`-dark`, `--shadow`
  …), not raw ramps.
- `3155c2c` — `docs/client/approach.md`.
- Test infra (from the server flat-problems work): tests live in
  `packages/<pkg>/tests/**`, NOT co-located. Vitest **projects**: `client`
  (jsdom) + `server` (node). `@/` alias → that package's `src/`. So a test
  imports `@/lib/Foo`, and lives at `tests/unit/...`.

## Your task

Build the landing page from `docs/mocks/index.html`. Concretely you will likely:

1. Install the router: `npm --workspace @qb/client i navigo`. Wire hash-mode
   routing into `main.ts` per the sketch in `approach.md` (`#app` is currently
   left empty on purpose — you take it over). One route: `#/` → `LandingPage`.
2. Author page + components with the `html` helper under `src/`, each with
   co-located CSS (`import './LandingPage.css'`). The mock is three big banner
   buttons — **Revisit** (purple/`--revisit`), **Learn** (green/`--learn`), and
   the **book/library list** below. Decompose into components as the mock's
   structure suggests (e.g. `Banner`, a book row/card, the page shell).
3. Fetch real library data from the API (the server is the data source; the
   client dev server proxies `/api` → `localhost:3001`, see `vite.config.ts`).
   Confirm the actual books endpoint shape against the server routes before
   wiring — do NOT assume field names.
4. Add an **integration test** for the page (jsdom, under
   `packages/client/tests/unit/` or a new `tests/integration/`), per the
   test-strategy memory: favor one high-level test that renders the page and
   asserts behavior over granular unit tests. The `html` helper already has its
   own tests; don't re-test it.

**Brainstorm with the user first** (use the brainstorming skill) — decomposition,
which components, data-loading approach, and empty/loading states are design
decisions they'll want input on. Don't just start coding the mock 1:1.

## Known quirks / gotchas

1. **The mocks are mid-edit by the user.** `docs/mocks/index.html`, `grade.html`,
   `learn.html`, and `mocks.css` have UNCOMMITTED working-tree changes (and
   `TODO.md`, `.claude/settings.local.json`). They are the user's, NOT yours —
   **do not stage, commit, revert, or "clean up" any of them.** Treat the mocks
   as read-only visual reference regardless.
2. **`index.html` links `mocks.css` + `single-screen.css` + `footer.js`.**
   `mocks.css` is already ported (tokens/reset). `single-screen.css` is the
   page-specific layout — author it FRESH as your page/component CSS, keeping the
   look/feel; do not copy-import it. `footer.js` is just the mock's
   anim-style switcher — ignore it.
3. **Mocks are reference, not code to port.** Keep palette + layout; write fresh
   TS/CSS to the conventions in `approach.md`. Class names stay stable/semantic
   (`.banner`, `.card`) — no CSS-Modules hashing.
4. **Tests: jsdom project, `tests/` tree, `@/` imports.** A test placed under
   `src/` will run in the wrong (server/node) project or not at all. Mirror the
   existing `tests/unit/lib/html.test.ts` layout.
5. **Commit messages:** `git commit -F <file>` (PowerShell drops a stray `@`
   from here-strings). Pre-v1: commit straight to `master`, no feature branch.
6. **Windows + Defender:** a one-time exclusion is already set, so vitest runs
   fast (~2s). If a first run ever hangs ~60s, just let it finish / re-run.

## If something fails

```bash
npm run test:client          # client suite alone (jsdom project)
npm run typecheck            # tsc -b + the two tsconfig.test.json typechecks
npm run dev:client           # vite dev server to see the page render in a browser
```
The server (for real data) starts via `npm run dev:server` (port 3001); `npm run
dev` runs both. Inspect server route shapes under `packages/server/src/routes/`.

## Do NOT

- Do NOT touch / stage / revert the user's in-flight mock + TODO edits (gotcha 1).
- Do NOT build `lib/latex.ts`, `EquationCard`, or any other page — landing only.
  Math rendering is for the learn/grade/edit pages, not this one.
- Do NOT co-locate tests under `src/` — they belong in `tests/` (gotcha 4).
- Do NOT assume the books API shape — read the server routes and verify.
