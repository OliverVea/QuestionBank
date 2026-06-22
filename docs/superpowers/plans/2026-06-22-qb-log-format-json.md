# QB_LOG_FORMAT=json Logging Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a backend-agnostic `QB_LOG_FORMAT=json` environment toggle so QuestionBank can emit one JSON object per log line (for machine ingestion) while keeping today's ANSI-colored human format as the default.

**Architecture:** Branch the existing `emit()` in `packages/server/src/logging/logger.ts` on a new `activeFormat()` helper (read from `process.env.QB_LOG_FORMAT` at call time, mirroring how `activeLevel()` already reads `QB_LOG_LEVEL`). Extract two pure renderers — `renderJson()` and `renderPretty()` — sharing the existing level-gating and console routing. JSON mode drops all ANSI. Then surface the toggle as a chart config value.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest (`server` project, node env), Helm (QuestionBank chart).

**Scope guard:** This plan is the *only* QuestionBank-side change for the OpenObserve logging effort. No OpenObserve, OTel, OTLP, or collector identifier may appear anywhere in this repo — `QB_LOG_FORMAT` is a generic structured-logging switch and names nothing backend-specific. The OpenObserve/collector stack lives entirely in the Olve.Homelab repo (separate plan).

**Reference — current logger contract (do not break):**
- `log.debug|info|warn|error(message, context?)` is the public surface; keep it identical.
- Level gating via `enabled(level)` against `QB_LOG_LEVEL` (default `info`) stays unchanged for both formats.
- Console routing stays: `error` → `console.error`, `warn` → `console.warn`, else → `console.log`.
- `describeError()` and `errorCode()` are unrelated and must not change.

---

### Task 1: JSON renderer for the logger

**Files:**
- Modify: `packages/server/src/logging/logger.ts`
- Test: `packages/server/src/logging/logger.test.ts` (append to existing file)

- [ ] **Step 1: Write the failing tests**

Append this block to `packages/server/src/logging/logger.test.ts`. Note the existing file already imports `{ describe, expect, it }` from `vitest` and `{ errorCode }` from `./logger.js` at the top — change that import line to also pull in `vi`, `beforeEach`, `afterEach`, and `log`:

Replace the existing first two lines:

```ts
import { describe, expect, it } from 'vitest';
import { errorCode } from './logger.js';
```

with:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorCode, log } from './logger.js';
```

Then append this `describe` block at the end of the file:

```ts
describe('QB_LOG_FORMAT=json', () => {
  const prevFormat = process.env.QB_LOG_FORMAT;
  const prevLevel = process.env.QB_LOG_LEVEL;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.QB_LOG_FORMAT = 'json';
    process.env.QB_LOG_LEVEL = 'debug'; // ensure nothing is gated out
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    if (prevFormat === undefined) delete process.env.QB_LOG_FORMAT;
    else process.env.QB_LOG_FORMAT = prevFormat;
    if (prevLevel === undefined) delete process.env.QB_LOG_LEVEL;
    else process.env.QB_LOG_LEVEL = prevLevel;
  });

  it('emits one parseable JSON object per line with ts, level, msg and context fields', () => {
    log.info('request handled', { route: '/grade', ms: 42 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('request handled');
    expect(parsed.route).toBe('/grade');
    expect(parsed.ms).toBe(42);
    expect(typeof parsed.ts).toBe('string');
    expect(Number.isNaN(Date.parse(parsed.ts))).toBe(false);
  });

  it('contains no ANSI escape codes in json mode', () => {
    log.warn('careful', { n: 1 });
    const line = logSpy.mock.calls.length
      ? (logSpy.mock.calls[0][0] as string)
      : (console.warn as unknown as ReturnType<typeof vi.fn>);
    // warn routes to console.warn, not console.log — assert via a fresh spy instead:
    expect(true).toBe(true);
  });

  it('routes error level to console.error in json mode', () => {
    log.error('boom', { code: 'E_X' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = errorSpy.mock.calls[0][0] as string;
    expect(line).not.toMatch(/\x1b\[/); // no ANSI
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('error');
    expect(parsed.code).toBe('E_X');
  });

  it('does not let context keys override the reserved ts/level/msg fields', () => {
    log.info('real message', { msg: 'spoofed', level: 'debug', ts: 'nope', keep: 'yes' });
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.msg).toBe('real message');
    expect(parsed.level).toBe('info');
    expect(parsed.ts).not.toBe('nope');
    expect(parsed.keep).toBe('yes');
  });

  it('skips undefined context values', () => {
    log.info('m', { a: undefined, b: 2 });
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect('a' in parsed).toBe(false);
    expect(parsed.b).toBe(2);
  });
});
```

> Note: the second test (`contains no ANSI escape codes in json mode`) is intentionally trivial here because `warn` routes to `console.warn`; the real no-ANSI assertion lives in the `error` test above where we already spy on `console.error`. Keep it as a placeholder-free smoke assertion or delete it — do not leave a TODO.

Simplify — replace that whole second `it(...)` block with this self-contained version that spies on `console.warn`:

```ts
  it('contains no ANSI escape codes in json mode', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log.warn('careful', { n: 1 });
    const line = warnSpy.mock.calls[0][0] as string;
    expect(line).not.toMatch(/\x1b\[/);
    expect(JSON.parse(line).level).toBe('warn');
    warnSpy.mockRestore();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project server packages/server/src/logging/logger.test.ts`
Expected: FAIL — the new `QB_LOG_FORMAT=json` suite fails because `emit()` still always renders the pretty (ANSI) format, so `JSON.parse(line)` throws on the colored string. The existing `errorCode` suite still passes.

- [ ] **Step 3: Implement the JSON branch in the logger**

In `packages/server/src/logging/logger.ts`, add a format reader and two renderers, then rewrite `emit()` to branch. Insert the `activeFormat` helper just after the existing `activeLevel()` function (around line 25):

```ts
type LogFormat = 'pretty' | 'json';

function activeFormat(): LogFormat {
  return (process.env.QB_LOG_FORMAT ?? '').toLowerCase() === 'json' ? 'json' : 'pretty';
}
```

Add the two renderers immediately above `emit()` (replacing nothing yet — `fmtContext`, `timestamp`, `COLORS`, `DIM`, `RESET` already exist and are reused by the pretty renderer):

```ts
const RESERVED_JSON_KEYS = new Set(['ts', 'level', 'msg']);

/** One JSON object per line: { ts, level, msg, ...context }. No ANSI. */
function renderJson(level: LogLevel, message: string, context?: Record<string, unknown>): string {
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
  };
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      if (value === undefined || RESERVED_JSON_KEYS.has(key)) continue;
      record[key] = value;
    }
  }
  return JSON.stringify(record);
}

/** Today's human format: dim timestamp, colored level tag, dim context. */
function renderPretty(level: LogLevel, message: string, context?: Record<string, unknown>): string {
  const color = COLORS[level];
  const tag = `${color}${level.toUpperCase().padEnd(5)}${RESET}`;
  return `${DIM}${timestamp()}${RESET} ${tag} ${message}${fmtContext(context)}`;
}
```

Now replace the existing `emit()` body. Change it from:

```ts
function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (!enabled(level)) return;
  const color = COLORS[level];
  const tag = `${color}${level.toUpperCase().padEnd(5)}${RESET}`;
  const line = `${DIM}${timestamp()}${RESET} ${tag} ${message}${fmtContext(context)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
```

to:

```ts
function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (!enabled(level)) return;
  const line =
    activeFormat() === 'json'
      ? renderJson(level, message, context)
      : renderPretty(level, message, context);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
```

- [ ] **Step 4: Run the full logger test file to verify it passes**

Run: `npx vitest run --project server packages/server/src/logging/logger.test.ts`
Expected: PASS — both the `errorCode` suite and the new `QB_LOG_FORMAT=json` suite are green.

- [ ] **Step 5: Confirm the default (pretty) path is unchanged**

Run the whole server+client suite to confirm nothing that depends on log output regressed:

Run: `npm test`
Expected: PASS — all existing tests still green (default format is `pretty`, unchanged byte-for-byte from before).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/logging/logger.ts packages/server/src/logging/logger.test.ts
git commit -m "feat(logging): add QB_LOG_FORMAT=json structured output toggle"
```

---

### Task 2: Surface the toggle in the Helm chart

**Files:**
- Modify: `helm/values.yaml` (the `config:` block, around lines 51–60)

The chart already renders every key under `.Values.config` as a container env var (`helm/templates/deployment.yaml:27-32` ranges over `.Values.config` and emits `name`/`value` pairs, skipping empty values). So enabling JSON logging in-cluster is purely a values addition — no template change.

- [ ] **Step 1: Add the config key**

In `helm/values.yaml`, inside the existing `config:` block, add `QB_LOG_FORMAT` after the existing entries. Change:

```yaml
config:
  NODE_ENV: "production"
  PORT: "3001"
  QB_DATA_DIR: "/data"
  # Authentik forwardAuth sets X-authentik-uid as the stable per-user identifier.
  QB_CUSTOMER_HEADER: "X-authentik-uid"
  # Multi-tenant by Authentik UID; never fall back to a shared default customer.
  QB_ALLOW_DEFAULT_CUSTOMER: "0"
  # In-cluster figure-service Service DNS.
  FIGURE_SERVICE_URL: "http://questionbank-figures.apps.svc.cluster.local"
```

to:

```yaml
config:
  NODE_ENV: "production"
  PORT: "3001"
  QB_DATA_DIR: "/data"
  # Authentik forwardAuth sets X-authentik-uid as the stable per-user identifier.
  QB_CUSTOMER_HEADER: "X-authentik-uid"
  # Multi-tenant by Authentik UID; never fall back to a shared default customer.
  QB_ALLOW_DEFAULT_CUSTOMER: "0"
  # In-cluster figure-service Service DNS.
  FIGURE_SERVICE_URL: "http://questionbank-figures.apps.svc.cluster.local"
  # Emit one JSON object per log line for machine ingestion (cluster log shipping).
  # Backend-agnostic: names no specific log sink. Unset/"pretty" = human ANSI format.
  QB_LOG_FORMAT: "json"
```

- [ ] **Step 2: Verify the env var renders into the Deployment**

Run: `helm template qb ./helm | grep -A1 'name: QB_LOG_FORMAT'`
Expected: output shows
```
            - name: QB_LOG_FORMAT
              value: "json"
```

- [ ] **Step 3: Commit**

```bash
git add helm/values.yaml
git commit -m "chore(helm): set QB_LOG_FORMAT=json for in-cluster structured logs"
```

---

## Self-Review

**Spec coverage** (against the QuestionBank section of `2026-06-22-openobserve-logging-design.md`):
- "Branch `emit()` on `QB_LOG_FORMAT`; `json` → `{ ts, level, msg, ...context }`, no ANSI" → Task 1, `renderJson` + reserved-key guard + no-ANSI test. ✓
- "unset / `pretty` (default) → today's ANSI format, unchanged" → Task 1 `renderPretty` (verbatim from old `emit`), verified by `npm test` in Step 5. ✓
- "Add `QB_LOG_FORMAT: \"json\"` to `helm/values.yaml` `config:` block" → Task 2. ✓
- "A small unit test asserts the JSON shape (and that pretty/unset preserves current behavior)" → Task 1 tests + Step 5. ✓
- "Existing `llm audit` line and request/error logs flow through `emit`, so they become structured automatically" → satisfied implicitly: all `log.*` calls route through the rewritten `emit`; no call-site changes needed. ✓
- "No OpenObserve/OTel identifier in QuestionBank" → only `QB_LOG_FORMAT` is introduced; scope guard honored. ✓

**Placeholder scan:** No TBD/TODO left. The one originally-weak test (no-ANSI on `warn`) was replaced inline in Task 1 Step 1 with a self-contained `console.warn` spy version.

**Type consistency:** `activeFormat(): LogFormat`, `renderJson`/`renderPretty` share the `(level: LogLevel, message: string, context?: Record<string, unknown>)` signature of `emit`. `LogLevel` is the existing exported type. `log` is the existing export imported by the test. Names consistent across tasks.
