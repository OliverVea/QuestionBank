# AGENTS.md

Guidance for AI coding agents working in this repo.

## Project goal

A question bank for books — a client-side app with a small server that owns the data. Optimised for **framework-free** code: the server uses Express, the client is plain TypeScript against the DOM. Do not pull in React/Vue/Svelte/Next/etc.

## Layout

- `packages/server` — Express API (TypeScript, ESM, Node >= 20)
- `packages/client` — Vite + vanilla TS frontend
- `data/` — JSON storage on disk, gitignored

npm workspaces tie them together. Run everything from the repo root.

## Conventions

- **TypeScript everywhere.** Strict mode is on (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, etc.). Don't loosen the config to make errors go away — fix the code.
- **ESM only.** `"type": "module"` is set; use `import`/`export`, no `require`.
- **Stay framework-free on the client.** If you reach for a UI library, stop and ask first.
- **Storage is JSON files.** Keep the storage layer thin and swappable — we may move to SQLite later.
- **Tests with Vitest.** Co-locate tests as `*.test.ts` next to the code they cover.

## Workflow

- `npm run dev` runs server + client together.
- `npm run typecheck` before declaring work done.
- `npm test` for the test suite.
- Verify changes in the browser at http://localhost:5173 before reporting UI work complete.

## Working style — incremental, demonstrable changes

WHEN WORKING ON CODE: Work in small increments where the change can be seen running. Every increment ends with something observable in the browser, not just code that type-checks. Slice work into vertical slivers (a working endpoint + the UI that hits it), not horizontal layers (all endpoints, then all UI).

Each increment follows this loop:

1. **Pick up work** — take the next slice; mark it in-progress in tracking.
2. **Implement** — make the change.
3. **Spin up the server locally** — get it running so the change is observable.
4. **Seed data (optional)** — populate demo data when it helps show the change.
5. **User tests** — the user exercises it in the browser.
6. **Iterate** — refine based on what the user sees.
7. **Finish** — commit the work.

## What not to do

- Don't add UI frameworks, CSS frameworks, or state-management libraries without asking.
- Don't add ORMs or database drivers while storage is still JSON.
- Don't introduce build steps beyond what Vite and `tsc` already give us.
- Don't scaffold features that weren't requested — keep changes scoped.
