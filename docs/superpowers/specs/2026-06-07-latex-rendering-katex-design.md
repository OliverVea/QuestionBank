# Foundation Sub-Project — LaTeX/Markdown Rendering (Manage tab, Step 3 / P0 polish)

**Status:** Draft — awaiting review. Open questions resolved against real data this session.
**Date:** 2026-06-07
**Architecture reference:** [2026-06-06-question-bank-architecture.md](./2026-06-06-question-bank-architecture.md)
**Foundation reference:** [2026-06-06-foundation-registration-design.md](./2026-06-06-foundation-registration-design.md)
**Builds on:** [2026-06-07-llm-image-ingestion-design.md](./2026-06-07-llm-image-ingestion-design.md)

## Scope

Step 3 of the foundation sub-project: the **static rendered view**. Today a question's
`canonicalText` is shown as raw source in a `<pre class="latex">` (deliberately, for
steps 1–2). This step renders it properly in **read mode** while keeping **edit mode**
on the raw source — the "finished editing" toggle the foundation spec called for. No
live preview (explicitly not wanted).

**Confirmed against real data this session** (`~/.question-bank/questions.json`, chapter 1
ingested): `canonicalText` is **mixed prose + math with light markdown**, not pure math.
So this step renders **markdown + LaTeX**, not a single KaTeX block. (See "Real-data
findings" — this is the central design driver.)

This is the last piece of the foundation build. After it, the foundation is done and
grading (Learn tab) slots in on proven ground.

**In scope:**

- KaTeX 0.17.0 for math, plus a **hand-rolled markdown+math splitter** for the prose around it.
- Read mode renders `canonicalText` (prose + inline `$…$` + display `$$…$$` + `**bold**`/`*italic*` + paragraph breaks); edit mode shows raw source (existing toggle, unchanged in shape).
- A reusable `renderContent(host, source)` helper so the same render path is reused by grading/SRS later.
- Graceful handling of math that fails to parse (malformed source must not blank the row).
- KaTeX stylesheet wired into the build (same `import` mechanism as `styles.css`).
- Client unit tests covering the splitter — added under the **existing root Vitest runner**, with
  `jsdom` introduced for the one DOM-touching test (`renderContent`).

**Out of scope (deferred / later):**

- **Live preview** while editing — explicitly unwanted (foundation spec).
- A richer dedicated editor view (a captured foundation deferred candidate).
- Rendering anywhere other than the Manage questions list (grading/SRS reuse the helper when they land — not built here).
- A **full** markdown implementation. We support only the markdown actually present in the data (bold, italic, paragraphs/line breaks, and the literal `(a) (b)` sub-part text). Lists, headings, links, tables, code spans, etc. are **not** implemented — if they ever appear, that's a follow-up (see Open questions).
- Server changes — purely client-side.

## Real-data findings (the design driver)

From the ingested chapter, `canonicalText` values contain:

- **Inline math** `$…$` — nearly every question: `Prove that $-(-v) = v$ for every $v \in V$.`
- **Display math** `$$…$$` — many, including environments: a `\begin{cases}…\end{cases}` block, aligned multi-line equations.
- **Markdown bold** `**…**` — `…is called **periodic** if…`.
- **Markdown italics** `*…*` — a bracketed editorial note (`[*This exercise is…*]`).
- **Multi-line** (`\n`) text and lettered sub-parts `(a) … (b) … (c) …`.

Rendering the whole string as one KaTeX expression (the naive approach) would feed English
prose to the math parser and error on almost every question. The text must be **segmented**:
math segments go to KaTeX, everything else is markdown prose.

## Decisions

- **Math library: KaTeX 0.17.0** — latest full release (per the dependency-currency standard, take the newest). First runtime dependency in `@qb/client` (package.json currently has only `vite` as a devDependency). A render function + a stylesheet, no component model — fits the framework-free client.
- **Markdown: hand-rolled, no library.** We render the *small, known* subset above ourselves rather than pulling a markdown(-it/marked) + katex-extension stack. Rationale: keeps the client at a single runtime dep (KaTeX), gives full control over the prose/math interleaving, and the subset is genuinely small. Cost — accepted — is our own parsing code, which is exactly what the new client test suite covers. (A markdown-math library remains the fallback if the subset grows; noted in Open questions.)
- **Types:** KaTeX 0.17 ships bundled `.d.ts`. Prefer those; only add `@types/katex` (lags at 0.16.8) if the bundled types are insufficient under the project's `tsc` strictness.
- **Read renders, edit is raw.** No simultaneous preview. Matches the foundation spec's "toggle between rendered-static and raw-edit." `editMode()` is unchanged.
- **Math failure is non-fatal:** KaTeX `throwOnError: false` — a malformed expression renders as KaTeX's visible error token, never throws/blanks the row. Raw source is always one "edit" click away.
- **Read-mode look: a subtle card per question** (light border + padding), replacing the grey monospace code box. Groups each question visually; rendered math/prose is not styled like code.

## Where it plugs in

Single touch-point in the existing read/edit toggle:

`packages/client/src/manage/questions-pane.ts` → `renderQuestionRow` → `readMode()`
(currently `questions-pane.ts:145-147`):

```ts
const pre = document.createElement('pre');
pre.className = 'latex';
pre.textContent = q.canonicalText; // raw source — rendering deferred to a later plan
body.appendChild(pre);
```

This becomes a call to the render helper. `editMode()` is **unchanged** — it already shows
the raw `canonicalText` in a `<textarea>`. The label rendering (the `<strong>` prefix)
stays as-is; only the body changes.

## Design

### Content renderer (`packages/client/src/render/content.ts`, new)

The reusable entry point. Renders `source` (prose + math + light markdown) into `host`:

```ts
import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * Render a question's canonicalText into `host`: prose with **bold**/*italic* and
 * paragraph breaks, with $…$ inline math and $$…$$ display math rendered by KaTeX.
 * Malformed math renders as KaTeX's visible error token (throwOnError: false) so a
 * bad expression never blanks the row — the raw source is recoverable via edit mode.
 */
export function renderContent(host: HTMLElement, source: string): void { … }
```

The module exposes **three** units so the pure logic is testable without a DOM, and only the
final assembly needs jsdom:

- `splitMath(source): Segment[]` — **pure.** Scans `source` for `$$…$$` (display) and `$…$`
  (inline) delimiters, producing an ordered list of segments:
  `{ kind: 'text', value }` | `{ kind: 'math', value, display }`.
  - `$$` is matched before `$` so display math isn't mis-split as two inline spans.
  - An **unbalanced** trailing `$`/`$$` (no closing delimiter) is treated as literal text,
    not an open math run — defensive against odd source.
  - Escaped `\$` is treated as a literal dollar sign, not a delimiter.
- `renderMarkup(text): string` — **pure.** Renders the minimal markdown we actually see in a
  `text` segment to an HTML string: `**bold**` → `<strong>`, `*italic*` → `<em>`, blank line →
  paragraph break, single `\n` → line break. **Everything else is escaped/literal** (so `(a)`,
  `_`, `^`, stray characters render as themselves). HTML-escapes before emitting markup, so
  question content cannot inject HTML.
- `renderContent(host, source): void` — **DOM.** Calls `splitMath`, then for each segment either
  inserts `renderMarkup`'s HTML (text) or renders math into a `<span>` via
  `katex.render(value, span, { displayMode, throwOnError: false })`.

Notes:

- **Stylesheet import lives in this module**, so any consumer pulls KaTeX's CSS transitively
  — no separate "remember the stylesheet" step. Vite bundles it like `main.ts`'s `import './styles.css'`.
- KaTeX bundles its fonts; Vite resolves the `@font-face` URLs from `katex.min.css`. Confirm
  fonts load (network tab) in verification.
- The helper owns `host`'s contents (clears then populates). Caller passes a dedicated container.

### Questions pane change

In `readMode()`, replace the raw `<pre>` body with a rendered card:

```ts
const content = document.createElement('div');
content.className = 'qbody';          // new class: the rendered-content card
renderContent(content, q.canonicalText);
body.appendChild(content);
```

`editMode()` stays raw. The old `pre.latex` read-mode styling is retired in favor of `.qbody`.

### Styling

- New `.qbody` rule: subtle card — light border (`var(--border)`), padding, rounded corners,
  comfortable line-height; **not** monospaced, no grey code background. KaTeX's own CSS sizes
  the math; `.qbody` styles only the container.
- Display math (`$$…$$`) should be allowed to scroll horizontally on narrow screens
  (`overflow-x: auto` on the display-math wrapper) so a wide equation doesn't break mobile layout.
- The **edit-mode** textarea is unchanged.
- The existing `pre.latex` rule is removed (or repurposed) once read mode no longer uses it.

## Dependencies

- Add `katex@0.17.0` to `@qb/client` `dependencies` (first runtime dep there).
- Add **`jsdom`** to the **root** `devDependencies`. Vitest `^4.1.8` already exists at the root
  and `npm test` (`vitest run`) already covers the whole workspace via the root
  `vitest.config.ts`; the client needs **no new runner and no per-package config**. The single
  DOM-touching test opts into jsdom with a per-file `// @vitest-environment jsdom` pragma — the
  pure `splitMath`/`renderMarkup` tests run under the default node environment, no pragma.
- Per the dependency-currency standard: these are *new* deps at newest release, not upgrades
  of old ones — no separate upgrade commit implicated. `@types/katex` only if bundled types fall short.

## Testing

The splitter and markup passes are pure and carry the real logic — they get the bulk of the
coverage with no DOM. One jsdom-tagged file covers the DOM assembly.

- **Unit — `splitMath`** (pure, no jsdom):
  - inline `$…$` → one math (inline) segment between text segments;
  - display `$$…$$` → one math (display) segment;
  - mixed real example (`Prove that $-(-v) = v$ for every $v \in V$.`) → text/math/text/math/text order correct;
  - `$$\begin{cases}…\end{cases}$$` kept as a single display segment;
  - unbalanced trailing `$` → treated as literal text (no thrown error, no swallowed tail);
  - escaped `\$` → literal dollar.
- **Unit — `renderMarkup`** (pure, no jsdom): `**bold**` → `<strong>`, `*italic*` → `<em>`,
  paragraph/line breaks, and that non-markdown punctuation like `(a)` / `_` / `^` survives literally and is HTML-escaped (no injection).
- **Unit — `renderContent` DOM** (`content.dom.test.ts`, `// @vitest-environment jsdom`): a known
  expression yields a `.katex` element in `host`; malformed `$\frac{1$` renders KaTeX's error
  token and `renderContent` does **not** throw (the `throwOnError:false` contract).
- **Manual verification (browser):** dev stack running; view the ingested chapter and confirm:
  1. Questions render as readable prose with proper math (not raw `$…$`/`\frac{}` source).
  2. `**bold**` / `*italic*` show as bold/italic, not literal asterisks.
  3. Display math (the `\begin{cases}` question, the aligned-equation questions) renders centered/blocked and scrolls rather than breaking layout on mobile.
  4. Edit shows raw source; save/cancel returns to the rendered card.
  5. A deliberately malformed question renders an error token, not a blank/crash.
  6. KaTeX fonts load (no fallback boxes) — check the network tab.
  7. Mobile and PC layouts both hold up.

## Build order

Each step ends with something observable.

1. **Splitter + markup (TDD, pure)** — `splitMath` and `renderMarkup` in `content.ts`, written test-first against the real-data cases above. Add `jsdom` to root devDependencies (unused until step 2). Observable: pure unit tests green under `npm test`, no DOM.
2. **KaTeX wiring + renderContent** — add `katex`, assemble segments into `host`, render math segments, import the stylesheet. A `content.dom.test.ts` (`// @vitest-environment jsdom`). Observable: `renderContent` produces a `.katex` element for a known expression in the jsdom test.
3. **Wire into the questions pane + styling** — swap `readMode()` to `renderContent` into a `.qbody` card; add `.qbody` CSS; retire `pre.latex` read styling. Observable: the ingested chapter renders properly in the browser; edit toggle still shows raw source.
4. **Polish + verify** — display-math overflow on mobile, malformed-source check, font load; run the manual verification list. Observable: foundation Step 3 demonstrably done.

## Open questions (resolved)

1. **Mixed prose + math — RESOLVED.** Real data is mixed prose + math with light markdown
   (see Real-data findings). Decision: hand-rolled markdown+math splitter, not whole-string KaTeX.
2. **Client test runner — RESOLVED.** Vitest already runs the workspace from the root; add only
   `jsdom` (root devDep) and cover the splitter/markup as pure units plus one jsdom-tagged DOM test.
3. **Read-mode styling — RESOLVED.** Subtle card per question (`.qbody`): light border + padding, no code box.

## Follow-up candidates (not in this step)

- Markdown beyond the observed subset (lists, headings, links, tables). If real questions
  start carrying them, either extend the hand-rolled renderer or swap to a markdown-math
  library — re-evaluate at that point.
- Reuse of `renderContent` in grading/SRS views (built when those sub-projects land).
- Copy-to-clipboard of raw LaTeX from read mode (minor convenience; unrequested).
