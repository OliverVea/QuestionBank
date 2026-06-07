# KaTeX / Markdown Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a question's `canonicalText` (mixed prose + `$…$`/`$$…$$` math + light markdown) properly in read mode, while edit mode keeps showing raw source.

**Architecture:** A new client module `render/content.ts` exposes three units: a pure `splitMath(source)` that segments a string into ordered text/math runs, a pure `renderMarkup(text)` that turns the small known markdown subset into an HTML string, and a DOM `renderContent(host, source)` that assembles segments — markup as HTML, math via KaTeX with `throwOnError: false`. The questions pane's `readMode()` swaps its raw `<pre>` for a `.qbody` card rendered by `renderContent`; `editMode()` is untouched.

**Tech Stack:** TypeScript, Vite, KaTeX 0.17, Vitest 4 (already at repo root), jsdom (new root devDependency).

**Spec:** [2026-06-07-latex-rendering-katex-design.md](../specs/2026-06-07-latex-rendering-katex-design.md)

---

## File Structure

- **Create** `packages/client/src/render/content.ts` — the renderer. Exports `splitMath`, `renderMarkup`, `renderContent`, and the `Segment` type. Imports `katex` + `katex/dist/katex.min.css`.
- **Create** `packages/client/src/render/content.test.ts` — pure unit tests for `splitMath` and `renderMarkup` (default node environment, no jsdom).
- **Create** `packages/client/src/render/content.dom.test.ts` — DOM tests for `renderContent` (tagged `// @vitest-environment jsdom`).
- **Modify** `packages/client/src/manage/questions-pane.ts:135-164` — `readMode()` replaces the raw `<pre class="latex">` with a `.qbody` div rendered via `renderContent`.
- **Modify** `packages/client/src/styles.css:108-115` — retire the `pre.latex` rule, add a `.qbody` rule.
- **Modify** `packages/client/package.json` — add `katex` to `dependencies`.
- **Modify** root `package.json` — add `jsdom` to `devDependencies`.

### Conventions to follow (verified in the codebase)

- Tests import their helpers from `vitest` explicitly (`import { describe, expect, it } from 'vitest';`) — there are no vitest globals. See `packages/server/src/domain/ids.test.ts`.
- Client source imports sibling modules with an explicit `.js` extension (e.g. `import { api } from '../api/client.js';`). KaTeX is a package import, no extension.
- `npm test` (from repo root) runs `vitest run` across the workspace; the root `vitest.config.ts` excludes `**/dist/**`. Run a single file with `npx vitest run <path>`.
- The client tsconfig has `"types": []`, so the jsdom-tagged test relies on the `DOM` lib (already in `lib`) for `document`/`HTMLElement`, not on ambient `@types`.

---

## Task 1: Add jsdom devDependency, scaffold the module

This task gets the new file and test files in place with the pure-function signatures stubbed (returning wrong/empty values) so later TDD steps have something to import. No behavior yet.

**Files:**
- Modify: root `package.json`
- Create: `packages/client/src/render/content.ts`

- [ ] **Step 1: Add jsdom to root devDependencies**

Run from the repo root:

```bash
npm install --save-dev --workspace . jsdom @types/jsdom
```

If the `--workspace .` form is rejected, run plain `npm install --save-dev jsdom @types/jsdom` from the repo root (root `package.json` is the workspace root). Expected: `jsdom` and `@types/jsdom` appear in root `package.json` `devDependencies`.

- [ ] **Step 2: Create the module with stubbed pure functions**

Create `packages/client/src/render/content.ts`:

```ts
/**
 * Render a question's canonicalText into `host`: prose with **bold** / *italic* and
 * paragraph breaks, with $…$ inline math and $$…$$ display math rendered by KaTeX.
 * Malformed math renders as KaTeX's visible error token (throwOnError: false) so a
 * bad expression never blanks the row — the raw source is recoverable via edit mode.
 *
 * Three units, two of them pure so the real logic is testable without a DOM:
 *   - splitMath(source): pure, source string -> ordered text/math segments
 *   - renderMarkup(text): pure, a text segment -> HTML string (small markdown subset)
 *   - renderContent(host, source): DOM assembly, math via KaTeX
 */

export type Segment =
  | { kind: 'text'; value: string }
  | { kind: 'math'; value: string; display: boolean };

/** Split source into ordered text/math segments. Pure. */
export function splitMath(source: string): Segment[] {
  return [{ kind: 'text', value: source }]; // stub — replaced in Task 2
}

/** Render the small known markdown subset of a text segment to an HTML string. Pure. */
export function renderMarkup(text: string): string {
  return text; // stub — replaced in Task 3
}
```

- [ ] **Step 3: Typecheck the new file compiles**

Run: `npx tsc -b packages/client`
Expected: PASS (no errors). The stubs are valid TypeScript.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json packages/client/src/render/content.ts
git commit -m "chore: scaffold render/content module and add jsdom devDependency"
```

---

## Task 2: `splitMath` — segment prose and math (TDD, pure)

**Files:**
- Modify: `packages/client/src/render/content.ts`
- Test: `packages/client/src/render/content.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/render/content.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { splitMath, renderMarkup } from './content.js';

describe('splitMath', () => {
  it('returns a single text segment when there is no math', () => {
    expect(splitMath('plain prose')).toEqual([{ kind: 'text', value: 'plain prose' }]);
  });

  it('extracts one inline $…$ segment between text', () => {
    expect(splitMath('a $x+1$ b')).toEqual([
      { kind: 'text', value: 'a ' },
      { kind: 'math', value: 'x+1', display: false },
      { kind: 'text', value: ' b' },
    ]);
  });

  it('extracts one display $$…$$ segment', () => {
    expect(splitMath('a $$x+1$$ b')).toEqual([
      { kind: 'text', value: 'a ' },
      { kind: 'math', value: 'x+1', display: true },
      { kind: 'text', value: ' b' },
    ]);
  });

  it('keeps the right text/math order for a mixed real example', () => {
    expect(splitMath('Prove that $-(-v) = v$ for every $v \\in V$.')).toEqual([
      { kind: 'text', value: 'Prove that ' },
      { kind: 'math', value: '-(-v) = v', display: false },
      { kind: 'text', value: ' for every ' },
      { kind: 'math', value: 'v \\in V', display: false },
      { kind: 'text', value: '.' },
    ]);
  });

  it('keeps a $$\\begin{cases}…\\end{cases}$$ block as one display segment', () => {
    const src = '$$\\begin{cases} a \\\\ b \\end{cases}$$';
    expect(splitMath(src)).toEqual([
      { kind: 'math', value: '\\begin{cases} a \\\\ b \\end{cases}', display: true },
    ]);
  });

  it('treats an unbalanced trailing $ as literal text (no swallowed tail)', () => {
    expect(splitMath('cost is $5 today')).toEqual([
      { kind: 'text', value: 'cost is $5 today' },
    ]);
  });

  it('treats an unbalanced trailing $$ as literal text', () => {
    expect(splitMath('open $$x+1')).toEqual([{ kind: 'text', value: 'open $$x+1' }]);
  });

  it('treats an escaped \\$ as a literal dollar, not a delimiter', () => {
    expect(splitMath('price \\$5 and \\$6')).toEqual([
      { kind: 'text', value: 'price $5 and $6' },
    ]);
  });

  it('does not mis-split display math as two inline spans', () => {
    // $$ must be tried before $: this is one display segment, not two inline.
    const out = splitMath('$$a$$');
    expect(out).toEqual([{ kind: 'math', value: 'a', display: true }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/client/src/render/content.test.ts`
Expected: FAIL — the stub returns a single text segment, so all but the first test fail.

- [ ] **Step 3: Implement `splitMath`**

Replace the `splitMath` stub in `packages/client/src/render/content.ts` with:

```ts
export function splitMath(source: string): Segment[] {
  const segments: Segment[] = [];
  let text = ''; // accumulates literal text (with \$ already unescaped) until the next math run

  const pushText = (): void => {
    if (text.length > 0) segments.push({ kind: 'text', value: text });
    text = '';
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i];

    // Escaped dollar: emit a literal '$' and skip both characters.
    if (ch === '\\' && source[i + 1] === '$') {
      text += '$';
      i += 2;
      continue;
    }

    if (ch === '$') {
      const display = source[i + 1] === '$';
      const open = display ? i + 2 : i + 1;
      const close = findClosingDollar(source, open, display);
      if (close === -1) {
        // Unbalanced: treat the rest as literal text. Consume one char and continue
        // so the '$' itself is preserved in the output.
        text += ch;
        i += 1;
        continue;
      }
      pushText();
      segments.push({ kind: 'math', value: source.slice(open, close), display });
      i = display ? close + 2 : close + 1;
      continue;
    }

    text += ch;
    i += 1;
  }

  pushText();
  return segments;
}

/**
 * Find the index of the closing delimiter starting the search at `from`.
 * For display math the closer is `$$`; for inline it is a single `$`.
 * An escaped `\$` inside is not a closer. Returns -1 if none found.
 */
function findClosingDollar(source: string, from: number, display: boolean): number {
  for (let j = from; j < source.length; j++) {
    if (source[j] === '\\') {
      j++; // skip the escaped character
      continue;
    }
    if (source[j] === '$') {
      if (display) {
        if (source[j + 1] === '$') return j;
        // a lone '$' inside a display run is not a closer; keep scanning
        continue;
      }
      return j;
    }
  }
  return -1;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/client/src/render/content.test.ts`
Expected: PASS — all `splitMath` tests green. (`renderMarkup` is still imported but only the stub's behavior is relied on; no `renderMarkup` tests yet.)

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/render/content.ts packages/client/src/render/content.test.ts
git commit -m "feat: splitMath segments prose and inline/display math"
```

---

## Task 3: `renderMarkup` — small markdown subset to HTML (TDD, pure)

**Files:**
- Modify: `packages/client/src/render/content.ts`
- Test: `packages/client/src/render/content.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `packages/client/src/render/content.test.ts` (inside the file, after the `splitMath` describe block):

```ts
describe('renderMarkup', () => {
  it('renders **bold** as <strong>', () => {
    expect(renderMarkup('a **b** c')).toBe('a <strong>b</strong> c');
  });

  it('renders *italic* as <em>', () => {
    expect(renderMarkup('a *b* c')).toBe('a <em>b</em> c');
  });

  it('renders a bold run that contains italic', () => {
    expect(renderMarkup('**a *b* c**')).toBe('<strong>a <em>b</em> c</strong>');
  });

  it('HTML-escapes content so questions cannot inject markup', () => {
    expect(renderMarkup('1 < 2 & <script>x</script>')).toBe(
      '1 &lt; 2 &amp; &lt;script&gt;x&lt;/script&gt;',
    );
  });

  it('leaves non-markdown punctuation like (a), _ and ^ literal', () => {
    expect(renderMarkup('(a) x_1 ^2')).toBe('(a) x_1 ^2');
  });

  it('turns a blank line into a paragraph break', () => {
    expect(renderMarkup('one\n\ntwo')).toBe('one</p><p>two');
  });

  it('turns a single newline into a line break', () => {
    expect(renderMarkup('one\ntwo')).toBe('one<br>two');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/client/src/render/content.test.ts`
Expected: FAIL — `renderMarkup` is still the identity stub.

- [ ] **Step 3: Implement `renderMarkup`**

Replace the `renderMarkup` stub in `packages/client/src/render/content.ts` with:

```ts
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  // `!` because noUncheckedIndexedAccess types the lookup as string|undefined,
  // but the regex character class guarantees `c` is always a key of HTML_ESCAPES.
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

export function renderMarkup(text: string): string {
  // 1. Escape first so question content can never inject HTML.
  let html = escapeHtml(text);
  // 2. Bold before italic so the inner * of **…** is consumed by bold, not italic.
  html = html.replace(/\*\*([^]+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
  // 3. Paragraph breaks (blank line) before line breaks (single newline).
  html = html.replace(/\n\n+/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  return html;
}
```

Note: the bold regex uses `[^]+?` (any char including newline, lazy) so a bold run is matched before the paragraph/line-break passes run. The italic regex uses `[^*]+?` so it cannot straddle a `**` boundary.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/client/src/render/content.test.ts`
Expected: PASS — all `splitMath` and `renderMarkup` tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/render/content.ts packages/client/src/render/content.test.ts
git commit -m "feat: renderMarkup renders bold/italic/breaks with HTML escaping"
```

---

## Task 4: `renderContent` — KaTeX + DOM assembly (TDD, jsdom)

**Files:**
- Modify: `packages/client/package.json` (add `katex`)
- Modify: `packages/client/src/render/content.ts`
- Test: `packages/client/src/render/content.dom.test.ts`

- [ ] **Step 1: Add the KaTeX dependency**

Run from the repo root:

```bash
npm install --workspace @qb/client katex@0.17.0
```

Expected: `"katex": "0.17.0"` (or `^0.17.0`) appears in `packages/client/package.json` `dependencies`.

- [ ] **Step 2: Write the failing DOM tests**

Create `packages/client/src/render/content.dom.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderContent } from './content.js';

describe('renderContent', () => {
  it('renders a known math expression into a .katex element', () => {
    const host = document.createElement('div');
    renderContent(host, 'value is $x+1$ here');
    expect(host.querySelector('.katex')).not.toBeNull();
    expect(host.textContent).toContain('value is');
    expect(host.textContent).toContain('here');
  });

  it('renders bold prose as a <strong> element', () => {
    const host = document.createElement('div');
    renderContent(host, 'this is **important**');
    expect(host.querySelector('strong')?.textContent).toBe('important');
  });

  it('does not throw on malformed math and renders an error token', () => {
    const host = document.createElement('div');
    expect(() => renderContent(host, 'broken $\\frac{1$ end')).not.toThrow();
    // KaTeX with throwOnError:false emits a .katex-error span rather than throwing.
    expect(host.querySelector('.katex-error')).not.toBeNull();
  });

  it('clears any prior content of the host before rendering', () => {
    const host = document.createElement('div');
    host.textContent = 'STALE';
    renderContent(host, 'fresh');
    expect(host.textContent).not.toContain('STALE');
    expect(host.textContent).toContain('fresh');
  });

  it('wraps display math so it can scroll horizontally', () => {
    const host = document.createElement('div');
    renderContent(host, '$$x+1$$');
    expect(host.querySelector('.qbody-display')).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run packages/client/src/render/content.dom.test.ts`
Expected: FAIL — `renderContent` is not exported yet (`renderContent is not a function`).

- [ ] **Step 4: Implement `renderContent`**

Add to the **top** of `packages/client/src/render/content.ts` (imports go above the existing `export type Segment`):

```ts
import katex from 'katex';
import 'katex/dist/katex.min.css';
```

Add this exported function to `packages/client/src/render/content.ts` (e.g. at the end of the file):

```ts
/**
 * Render `source` into `host`. Owns the host's contents: clears it, then appends
 * rendered prose (with the small markdown subset) and KaTeX-rendered math. Display
 * math is wrapped in a `.qbody-display` element that scrolls horizontally on narrow
 * screens. Malformed math renders as KaTeX's visible error token (throwOnError:false)
 * and never throws.
 */
export function renderContent(host: HTMLElement, source: string): void {
  host.innerHTML = '';
  for (const segment of splitMath(source)) {
    if (segment.kind === 'text') {
      const span = document.createElement('span');
      span.innerHTML = renderMarkup(segment.value);
      host.appendChild(span);
      continue;
    }
    const mathHost = segment.display ? document.createElement('div') : document.createElement('span');
    if (segment.display) mathHost.className = 'qbody-display';
    katex.render(segment.value, mathHost, {
      displayMode: segment.display,
      throwOnError: false,
    });
    host.appendChild(mathHost);
  }
}
```

- [ ] **Step 5: Run the DOM tests to verify they pass**

Run: `npx vitest run packages/client/src/render/content.dom.test.ts`
Expected: PASS — all five `renderContent` tests green.

- [ ] **Step 6: Run the whole client test set and typecheck**

Run: `npx vitest run packages/client` then `npx tsc -b packages/client`
Expected: PASS both — pure tests + DOM tests green, no type errors. (If `tsc` complains about KaTeX types, the spec allows adding `@types/katex` as a devDependency to `@qb/client`; only do so if the bundled types are insufficient.)

- [ ] **Step 7: Commit**

```bash
git add packages/client/package.json package-lock.json packages/client/src/render/content.ts packages/client/src/render/content.dom.test.ts
git commit -m "feat: renderContent assembles prose and KaTeX math into the DOM"
```

---

## Task 5: Wire into the questions pane + styling

**Files:**
- Modify: `packages/client/src/manage/questions-pane.ts:135-164` (`readMode()`)
- Modify: `packages/client/src/styles.css:108-115`

- [ ] **Step 1: Import the renderer in the questions pane**

In `packages/client/src/manage/questions-pane.ts`, add to the imports at the top (after the existing imports on lines 1-2):

```ts
import { renderContent } from '../render/content.js';
```

- [ ] **Step 2: Replace the raw `<pre>` body in `readMode()`**

In `packages/client/src/manage/questions-pane.ts`, inside `readMode()`, replace these three lines (currently around lines 145-148):

```ts
    const pre = document.createElement('pre');
    pre.className = 'latex';
    pre.textContent = q.canonicalText; // raw source — rendering deferred to a later plan
    body.appendChild(pre);
```

with:

```ts
    const content = document.createElement('div');
    content.className = 'qbody';
    renderContent(content, q.canonicalText);
    body.appendChild(content);
```

Leave the `q.label` `<strong>` prefix above it and `editMode()` (the textarea) unchanged.

- [ ] **Step 3: Update the stylesheet**

In `packages/client/src/styles.css`, replace the `pre.latex` rule (currently lines 108-115):

```css
pre.latex {
  margin: 0;
  white-space: pre-wrap;
  font-family: ui-monospace, monospace;
  background: #f6f6f6;
  padding: 0.3rem 0.5rem;
  border-radius: 4px;
}
```

with:

```css
.qbody {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
  line-height: 1.5;
}

.qbody-display {
  overflow-x: auto;
}
```

- [ ] **Step 4: Typecheck and run the full test suite**

Run: `npx tsc -b packages/client` then `npm test`
Expected: PASS both — the pane compiles against `renderContent`, and the whole workspace test suite (server + client) stays green.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/manage/questions-pane.ts packages/client/src/styles.css
git commit -m "feat: render questions with KaTeX in read mode, retire pre.latex"
```

---

## Task 6: Build verification + manual browser check

**Files:** none (verification only).

- [ ] **Step 1: Production build**

Run from the repo root: `npm run build`
Expected: PASS — `tsc -b` and `vite build` both succeed. Confirm the build output references KaTeX's CSS/fonts (Vite bundles `katex.min.css` and its `@font-face` URLs).

- [ ] **Step 2: Start the dev stack**

Run: `npm run dev` (server on its port, client via Vite). Open the client in a browser and navigate to a chapter that has ingested questions (real data lives under `~/.question-bank/questions.json`).

- [ ] **Step 3: Walk the manual verification checklist (from the spec)**

Confirm each, in the browser:
1. Questions render as readable prose with proper math — not raw `$…$` / `\frac{}` source.
2. `**bold**` / `*italic*` show as bold/italic, not literal asterisks.
3. Display math (the `\begin{cases}` question, aligned-equation questions) renders blocked/centered and **scrolls** rather than breaking layout when the window is narrowed (mobile width).
4. Clicking **edit** shows raw source in the textarea; **save**/**cancel** returns to the rendered `.qbody` card.
5. A deliberately malformed question (edit one to `$\frac{1$` and save) renders a KaTeX error token, not a blank row or a crash.
6. KaTeX fonts load — no fallback boxes; check the Network tab for the `KaTeX_*` font files (200, not 404).
7. Both desktop and narrow/mobile widths hold up.

- [ ] **Step 4: Note any follow-ups**

If a question surfaces markdown beyond the supported subset (lists, headings, links, tables), it renders literally — that is expected and is a captured follow-up in the spec, not a bug to fix here.

---

## Self-Review notes

- **Spec coverage:** `splitMath` (Task 2) covers the math-split requirements incl. `$$`-before-`$`, unbalanced-trailing, escaped `\$`, and the `\begin{cases}` case. `renderMarkup` (Task 3) covers bold/italic/paragraph/line-break + HTML-escaping + literal `(a)`/`_`/`^`. `renderContent` (Task 4) covers KaTeX render, non-fatal malformed math, host-clearing, and display-math scroll wrapper. Pane wiring + `.qbody` styling + retiring `pre.latex` (Task 5). Dependencies: `katex` (Task 4 Step 1), `jsdom` (Task 1 Step 1). Manual verification list (Task 6).
- **Type consistency:** `Segment`, `splitMath`, `renderMarkup`, `renderContent` signatures are identical everywhere they appear. The display-math wrapper class `.qbody-display` matches between the Task 4 test, the Task 4 implementation, and the Task 5 stylesheet.
- **Placeholders:** none — every code step shows complete code; every run step shows the command and expected result.
