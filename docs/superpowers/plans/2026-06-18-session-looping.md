# Session Looping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a session "shape" to the existing Learn/Practice loops — a per-mode completed-item counter (19c), a celebratory pause checkpoint (19d), and a configurable Practice pause interval (19e) — without changing how items are fetched or graded.

**Architecture:** A client-only in-memory singleton (`lib/session.ts`) holds an independent `count` + `lastChapter` per mode. The grade page records a completion at save time; the Learn/Revisit pages consult `shouldPause()` when the next item loads and render a new `SessionPause` component instead of the question card when a boundary is crossed (Learn = chapter seam, Practice = every N). The interval N is a new server `pauseEvery` setting (default 10) carried by `GET/PUT /api/settings`.

**Tech Stack:** TypeScript, hand-built DOM via the `html` tagged-template helper, Express + JSON store on the server, Vitest (`server` node project, `client` jsdom project).

**Spec:** `docs/superpowers/specs/2026-06-17-session-looping-design.md`
**Mock:** `docs/mocks/session-pause.html` + `.css`

**Synced to:** `master` @ `89c0ada`. Note: the Learn/Revisit/Grade photo-upload footer was refactored upstream into an `ImageSourcePicker` component (commit `952904e`). That refactor does NOT touch the `render()` / `loadNext()` / `saveAttempt()` / `boot()` code this plan edits — line anchors below are current as of `89c0ada`.

---

## File Structure

**New files**
- `packages/client/src/lib/session.ts` — the session singleton (counter + pause logic). One responsibility: session state + pause rules.
- `packages/client/tests/unit/lib/session.test.ts` — pure-logic unit tests for the singleton.
- `packages/client/src/components/SessionPause.ts` — the pause checkpoint component (ports the mock).
- `packages/client/src/components/SessionPause.css` — pause card styles (ported from `session-pause.css`, scoped to `.session-pause`).
- `packages/client/tests/integration/SessionPause.test.ts` — jsdom render + button-wiring test.

**Modified files**
- `packages/server/src/domain/types.ts` — add `pauseEvery` to `Settings`.
- `packages/server/src/routes/settings.ts` — carry + validate `pauseEvery` on GET/PUT; new `customerSettings()` read.
- `packages/server/src/uat/api-uat.test.ts` — extend the settings UAT for `pauseEvery`.
- `packages/client/src/lib/types.ts` — add `pauseEvery` to the client `Settings` type.
- `packages/client/src/pages/SettingsPage.ts` — third field "Pause every … reviews".
- `packages/client/src/pages/GradePage.ts` — record completion at save time.
- `packages/client/src/pages/LearnPage.ts` — pause on chapter seam; reset on caught-up.
- `packages/client/src/pages/RevisitPage.ts` — fetch `pauseEvery`; pause every N; reset on caught-up.

**Key contract used throughout** — `splitLabel(label)` from `packages/client/src/lib/problem-grouping.ts` returns `{ chapter, section } | null`; `chapter` is the first dotted-path segment (`"1.A.3" → "1"`, `"" → null`).

**Test commands**
- Server: `npx vitest run --project server`
- Client: `npx vitest run --project client`
- A single client file: `npx vitest run --project client packages/client/tests/unit/lib/session.test.ts`

---

## Task 1: Server `pauseEvery` setting (backend, TODO 19e)

**Files:**
- Modify: `packages/server/src/domain/types.ts:141-149`
- Modify: `packages/server/src/routes/settings.ts`
- Test: `packages/server/src/uat/api-uat.test.ts:387-414` and `:847-857`

- [ ] **Step 1: Extend the settings UAT (failing test)**

Replace the body of the existing test at `packages/server/src/uat/api-uat.test.ts:387-414` with:

```ts
  it('Settings: GET defaults, PUT upserts goals + pauseEvery, and /activity reflects the new targets', async () => {
    // No record yet ⇒ GET returns the defaults the header would otherwise hardcode (pauseEvery defaults to 10).
    const initial = (await request(app).get('/api/settings')).body;
    expect(initial).toEqual({ daysGoal: 3, problemsGoal: 20, pauseEvery: 10 });
    expect((await request(app).get('/api/activity')).body).toMatchObject({ daysGoal: 3, problemsGoal: 20 });

    // Upsert goals WITHOUT pauseEvery (back-compat body) — pauseEvery defaults to 10 in the response.
    const saved = await request(app).put('/api/settings').send({ daysGoal: 5, problemsGoal: 40 });
    expect(saved.status).toEqual(200);
    expect(saved.body).toEqual({ daysGoal: 5, problemsGoal: 40, pauseEvery: 10 });

    // GET now reads the stored record, and the new targets flow into the activity header (which ignores pauseEvery).
    expect((await request(app).get('/api/settings')).body).toEqual({ daysGoal: 5, problemsGoal: 40, pauseEvery: 10 });
    expect((await request(app).get('/api/activity')).body).toMatchObject({ daysGoal: 5, problemsGoal: 40 });

    // PUT WITH pauseEvery stores it; GET reflects it.
    const withPause = await request(app).put('/api/settings').send({ daysGoal: 2, problemsGoal: 15, pauseEvery: 5 });
    expect(withPause.body).toEqual({ daysGoal: 2, problemsGoal: 15, pauseEvery: 5 });
    expect((await request(app).get('/api/settings')).body).toEqual({ daysGoal: 2, problemsGoal: 15, pauseEvery: 5 });

    // Guards: days out of 1–7, problems < 1, non-integers, and bad pauseEvery are all 400; nothing persists.
    expect((await request(app).put('/api/settings').send({ daysGoal: 0, problemsGoal: 15 })).status).toEqual(400);
    expect((await request(app).put('/api/settings').send({ daysGoal: 8, problemsGoal: 15 })).status).toEqual(400);
    expect((await request(app).put('/api/settings').send({ daysGoal: 3, problemsGoal: 0 })).status).toEqual(400);
    expect((await request(app).put('/api/settings').send({ daysGoal: 3.5, problemsGoal: 15 })).status).toEqual(400);
    expect((await request(app).put('/api/settings').send({ daysGoal: 3, problemsGoal: 15, pauseEvery: 0 })).status).toEqual(400);
    expect((await request(app).put('/api/settings').send({ daysGoal: 3, problemsGoal: 15, pauseEvery: 2.5 })).status).toEqual(400);
    // The last good save is intact after the rejected ones.
    expect((await request(app).get('/api/settings')).body).toEqual({ daysGoal: 2, problemsGoal: 15, pauseEvery: 5 });
  });
```

Then update the per-customer isolation test expectations at `packages/server/src/uat/api-uat.test.ts:854-855`:

```ts
    expect((await as(request(segApp).get('/api/settings'), A)).body).toEqual({ daysGoal: 6, problemsGoal: 50, pauseEvery: 10 });
    expect((await as(request(segApp).get('/api/settings'), B)).body).toEqual({ daysGoal: 3, problemsGoal: 20, pauseEvery: 10 });
```

- [ ] **Step 2: Run the UAT to verify it fails**

Run: `npx vitest run --project server packages/server/src/uat/api-uat.test.ts`
Expected: FAIL — GET returns `{ daysGoal, problemsGoal }` with no `pauseEvery`, so the `toEqual` comparisons mismatch.

- [ ] **Step 3: Add `pauseEvery` to the `Settings` domain type**

In `packages/server/src/domain/types.ts`, change the `Settings` interface (currently ending at line 149) to add the field:

```ts
export interface Settings {
  /** Equals customerId — the per-customer singleton key. */
  id: string;
  customerId: string;
  /** Cadence target: study N days/week. */
  daysGoal: number;
  /** Volume target: solve N problems/week. */
  problemsGoal: number;
  /** Practice pause cadence: show the session pause every N reviews. */
  pauseEvery: number;
}
```

- [ ] **Step 4: Carry + validate `pauseEvery` in the settings route**

Rewrite `packages/server/src/routes/settings.ts` to:

```ts
import { Router } from 'express';
import type { Settings } from '../domain/types.js';
import { requireCustomerId } from '../middleware/resolve-customer.js';
import { DEFAULT_GOALS, type Goals } from '../services/activity.js';
import type { Store } from '../storage/store.js';

/** Bounds for the weekly goals, mirroring the input constraints in the mock. */
const DAYS_MIN = 1;
const DAYS_MAX = 7;
const PROBLEMS_MIN = 1;
const PAUSE_MIN = 1;

/** Default Practice pause cadence when no record (or an older record) carries one. */
export const DEFAULT_PAUSE_EVERY = 10;

/** A positive integer within [min, max] (max optional). */
function isIntInRange(value: unknown, min: number, max?: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    (max === undefined || value <= max)
  );
}

/**
 * The customer's stored goals, falling back to the defaults when no settings
 * record exists yet. Shared with the activity route so the header reads the same
 * source as the editor. NOTE: this intentionally omits pauseEvery — the activity
 * header only counts goals, and its tests assert the exact goals shape.
 */
export async function customerGoals(store: Store, customerId: string): Promise<Goals> {
  const record = await store.settings.getById(customerId, customerId);
  if (!record) return DEFAULT_GOALS;
  return { daysGoal: record.daysGoal, problemsGoal: record.problemsGoal };
}

/** The full settings view returned by GET/PUT /api/settings (goals + pauseEvery). */
export interface SettingsView {
  daysGoal: number;
  problemsGoal: number;
  pauseEvery: number;
}

/** Read the customer's settings view, defaulting goals AND pauseEvery for absent/older records. */
export async function customerSettings(store: Store, customerId: string): Promise<SettingsView> {
  const record = await store.settings.getById(customerId, customerId);
  if (!record) return { ...DEFAULT_GOALS, pauseEvery: DEFAULT_PAUSE_EVERY };
  return {
    daysGoal: record.daysGoal,
    problemsGoal: record.problemsGoal,
    pauseEvery: record.pauseEvery ?? DEFAULT_PAUSE_EVERY,
  };
}

/**
 * /api/settings — read (GET, defaulting) and upsert (PUT) the customer's weekly
 * goals plus the Practice pause cadence. The settings record is a per-customer
 * singleton keyed by `id === customerId`.
 */
export function settingsRouter(store: Store): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await customerSettings(store, requireCustomerId(req)));
  });

  router.put('/', async (req, res) => {
    const customerId = requireCustomerId(req);
    const { daysGoal, problemsGoal, pauseEvery } = req.body ?? {};
    if (!isIntInRange(daysGoal, DAYS_MIN, DAYS_MAX)) {
      res.status(400).json({ error: `daysGoal must be an integer in ${DAYS_MIN}–${DAYS_MAX}` });
      return;
    }
    if (!isIntInRange(problemsGoal, PROBLEMS_MIN)) {
      res.status(400).json({ error: `problemsGoal must be an integer ≥ ${PROBLEMS_MIN}` });
      return;
    }
    // pauseEvery is optional on PUT (back-compat): validate when present, else keep prior/default.
    if (pauseEvery !== undefined && !isIntInRange(pauseEvery, PAUSE_MIN)) {
      res.status(400).json({ error: `pauseEvery must be an integer ≥ ${PAUSE_MIN}` });
      return;
    }

    const existing = await store.settings.getById(customerId, customerId);
    const effectivePause = pauseEvery ?? existing?.pauseEvery ?? DEFAULT_PAUSE_EVERY;
    if (existing) {
      await store.settings.update(customerId, customerId, { daysGoal, problemsGoal, pauseEvery: effectivePause });
    } else {
      const record: Settings = { id: customerId, customerId, daysGoal, problemsGoal, pauseEvery: effectivePause };
      await store.settings.create(customerId, record);
    }
    res.json({ daysGoal, problemsGoal, pauseEvery: effectivePause });
  });

  return router;
}
```

- [ ] **Step 5: Run the UAT to verify it passes**

Run: `npx vitest run --project server packages/server/src/uat/api-uat.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full server suite (no regressions)**

Run: `npx vitest run --project server`
Expected: PASS (activity tests still green — they use `customerGoals`, untouched).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/domain/types.ts packages/server/src/routes/settings.ts packages/server/src/uat/api-uat.test.ts
git commit -m "feat(settings): add configurable pauseEvery to /api/settings (TODO 19e)"
```

---

## Task 2: Client `Settings` type + Settings page field (frontend, TODO 19e)

**Files:**
- Modify: `packages/client/src/lib/types.ts:84-88`
- Modify: `packages/client/src/pages/SettingsPage.ts`

> No new automated test: SettingsPage has no existing test harness and the field follows the exact baseline/dirty pattern already covered by manual settings testing. Verified manually in Task 7's run-through.

- [ ] **Step 1: Add `pauseEvery` to the client Settings type**

In `packages/client/src/lib/types.ts`, change the `Settings` interface (lines 84-88) to:

```ts
/** The customer's editable settings, from GET/PUT /api/settings. */
export interface Settings {
  daysGoal: number;
  problemsGoal: number;
  pauseEvery: number;
}
```

- [ ] **Step 2: Add the pause input element**

In `packages/client/src/pages/SettingsPage.ts`, after the `problemsInput` block (ends at line 30), add:

```ts
  const pauseInput = document.createElement('input');
  pauseInput.className = 'field-in';
  pauseInput.id = 'pause-in';
  pauseInput.type = 'number';
  pauseInput.inputMode = 'numeric';
  pauseInput.min = '1';
```

- [ ] **Step 3: Track the pause field in dirty detection**

In `SettingsPage.ts`, change `syncSave()` (lines 49-58) to include the pause field:

```ts
  function syncSave(): void {
    if (!saved) {
      (saveBtn as HTMLButtonElement).disabled = true;
      return;
    }
    const days = readValue(daysInput, saved.daysGoal);
    const problems = readValue(problemsInput, saved.problemsGoal);
    const pause = readValue(pauseInput, saved.pauseEvery);
    const dirty = days !== saved.daysGoal || problems !== saved.problemsGoal || pause !== saved.pauseEvery;
    (saveBtn as HTMLButtonElement).disabled = !dirty;
  }
```

And add its input listener after line 61 (`problemsInput.addEventListener('input', syncSave);`):

```ts
  pauseInput.addEventListener('input', syncSave);
```

- [ ] **Step 4: Add a Practice section to the form template**

In `SettingsPage.ts`, add a `pauseHost` next to `fieldsHost` (after line 64):

```ts
  const pauseHost = html`<div class="settings-fields"></div>`;
  pauseHost.appendChild(Spinner());
```

Then change the `form` template (lines 66-76) to add a second section:

```ts
  const form = html`<form class="settings-stage" id="settings-form" autocomplete="off">
    <h1 class="settings-title">Settings</h1>

    <section class="goals">
      <div class="section-head">
        <h2>Weekly goals</h2>
        <p class="section-sub">What the activity header on your home screen counts toward.</p>
      </div>
      ${fieldsHost}
    </section>

    <section class="goals">
      <div class="section-head">
        <h2>Practice</h2>
        <p class="section-sub">How often a Practice session pauses to let you take a break.</p>
      </div>
      ${pauseHost}
    </section>
  </form>`;
```

- [ ] **Step 5: Send `pauseEvery` in the PUT body**

In `SettingsPage.ts`, change the submit handler (lines 78-101). Update the read + body:

```ts
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!saved) return;
    const daysGoal = readValue(daysInput, saved.daysGoal);
    const problemsGoal = readValue(problemsInput, saved.problemsGoal);
    const pauseEvery = readValue(pauseInput, saved.pauseEvery);

    (saveBtn as HTMLButtonElement).disabled = true;
    saveBtn.textContent = 'Saving…';
    saveError.hidden = true;
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daysGoal, problemsGoal, pauseEvery }),
      });
      if (!res.ok) throw new Error('Failed to save settings');
      window.location.hash = '#/';
    } catch {
      saveBtn.textContent = 'Save changes';
      (saveBtn as HTMLButtonElement).disabled = false;
      saveError.textContent = "Couldn't save — check the values and try again.";
      saveError.hidden = false;
    }
  });
```

- [ ] **Step 6: Populate the pause field on load**

In `SettingsPage.ts`, change `loadSettings()` (lines 115-136):

```ts
  async function loadSettings(): Promise<void> {
    const fetched = await fetch('/api/settings')
      .then((r) => (r.ok ? (r.json() as Promise<Settings>) : null))
      .catch(() => null);
    // Fall back to the defaults the server would apply, so the form is still usable offline.
    saved = fetched ?? { daysGoal: 3, problemsGoal: 20, pauseEvery: 10 };
    daysInput.value = String(saved.daysGoal);
    problemsInput.value = String(saved.problemsGoal);
    pauseInput.value = String(saved.pauseEvery);

    fieldsHost.replaceChildren(
      html`<label class="field">
        <span class="field-lbl">Study days <span class="field-opt">per week</span></span>
        ${daysInput}
      </label>`,
      html`<label class="field field-block">
        <span class="field-lbl">Problems <span class="field-opt">per week</span></span>
        ${problemsInput}
      </label>`,
    );
    pauseHost.replaceChildren(
      html`<label class="field field-block">
        <span class="field-lbl">Pause every <span class="field-opt">reviews</span></span>
        ${pauseInput}
      </label>`,
    );
    saveBtn.textContent = 'Save changes';
    syncSave();
  }
```

- [ ] **Step 7: Typecheck the client**

Run: `npx tsc -b packages/client`
Expected: exit 0 (no type errors — `Settings` now has `pauseEvery` everywhere it is used).

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/lib/types.ts packages/client/src/pages/SettingsPage.ts
git commit -m "feat(settings): pause-every field on the Settings page (TODO 19e)"
```

---

## Task 3: Session singleton `lib/session.ts` (TODO 19c)

**Files:**
- Create: `packages/client/src/lib/session.ts`
- Test: `packages/client/tests/unit/lib/session.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `packages/client/tests/unit/lib/session.test.ts`:

```ts
import { describe, test, expect, beforeEach } from 'vitest';
import {
  recordCompleted,
  getCount,
  getLastChapter,
  shouldPause,
  reset,
} from '@/lib/session';

// The singleton is module-level state; reset both modes before each test.
beforeEach(() => {
  reset('learn');
  reset('revisit');
});

describe('session counter', () => {
  test('counts completions per mode, independently', () => {
    recordCompleted('learn', '1');
    recordCompleted('learn', '1');
    recordCompleted('revisit');
    expect(getCount('learn')).toBe(2);
    expect(getCount('revisit')).toBe(1);
  });

  test('reset zeroes the count and clears lastChapter for that mode only', () => {
    recordCompleted('learn', '2');
    recordCompleted('revisit');
    reset('learn');
    expect(getCount('learn')).toBe(0);
    expect(getLastChapter('learn')).toBeNull();
    expect(getCount('revisit')).toBe(1); // untouched
  });
});

describe('learn pause: chapter seam', () => {
  test('no pause before the first item (no previous completion)', () => {
    expect(shouldPause('learn', { nextChapter: '1' })).toBe(false);
  });

  test('no pause when the next chapter matches the last completed chapter', () => {
    recordCompleted('learn', '1');
    expect(shouldPause('learn', { nextChapter: '1' })).toBe(false);
  });

  test('pause when the next chapter differs from the last completed chapter', () => {
    recordCompleted('learn', '1');
    expect(shouldPause('learn', { nextChapter: '2' })).toBe(true);
  });

  test('lastChapter reflects the most recent completion', () => {
    recordCompleted('learn', '1');
    recordCompleted('learn', '2');
    expect(getLastChapter('learn')).toBe('2');
    expect(shouldPause('learn', { nextChapter: '2' })).toBe(false);
  });
});

describe('revisit pause: every N', () => {
  test('pauses at multiples of pauseEvery, not between', () => {
    for (let i = 0; i < 9; i++) {
      recordCompleted('revisit');
      expect(shouldPause('revisit', { pauseEvery: 10 })).toBe(false);
    }
    recordCompleted('revisit'); // 10th
    expect(shouldPause('revisit', { pauseEvery: 10 })).toBe(true);
  });

  test('never pauses at count 0', () => {
    expect(shouldPause('revisit', { pauseEvery: 1 })).toBe(false);
  });

  test('continuing keeps the count climbing across a pause', () => {
    for (let i = 0; i < 10; i++) recordCompleted('revisit');
    expect(shouldPause('revisit', { pauseEvery: 10 })).toBe(true); // pause shown
    recordCompleted('revisit'); // user kept going → 11th
    expect(getCount('revisit')).toBe(11);
    expect(shouldPause('revisit', { pauseEvery: 10 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project client packages/client/tests/unit/lib/session.test.ts`
Expected: FAIL — cannot resolve `@/lib/session` (module does not exist).

- [ ] **Step 3: Implement the singleton**

Create `packages/client/src/lib/session.ts`:

```ts
/**
 * Session looping state — an in-memory, client-only singleton that gives the
 * Learn and Practice loops a sense of a "session": a running count of completed
 * items per mode, plus the rule for when to show the celebratory pause checkpoint.
 *
 * Deliberately NOT persisted: a full reload / PWA relaunch clears it. Counts are
 * independent per mode. See docs/superpowers/specs/2026-06-17-session-looping-design.md.
 */
export type SessionMode = 'learn' | 'revisit';

interface ModeSession {
  count: number;
  /** Chapter of the most recently completed learn item; null for revisit / fresh. */
  lastChapter: string | null;
}

const sessions: Record<SessionMode, ModeSession> = {
  learn: { count: 0, lastChapter: null },
  revisit: { count: 0, lastChapter: null },
};

/**
 * Record one completed item. For `learn`, pass the completed item's chapter so the
 * next load can detect a chapter seam; for `revisit` the chapter is ignored.
 */
export function recordCompleted(mode: SessionMode, chapter: string | null = null): void {
  const s = sessions[mode];
  s.count += 1;
  if (mode === 'learn') s.lastChapter = chapter;
}

/** The running count of completed items for a mode. */
export function getCount(mode: SessionMode): number {
  return sessions[mode].count;
}

/** The chapter of the most recently completed item (learn only; null otherwise). */
export function getLastChapter(mode: SessionMode): string | null {
  return sessions[mode].lastChapter;
}

export interface ShouldPauseOpts {
  /** The incoming next item's chapter (learn seam detection). */
  nextChapter?: string | null;
  /** The Practice pause cadence (revisit every-N detection). Defaults to 10. */
  pauseEvery?: number;
}

/**
 * Whether to show the pause checkpoint BEFORE rendering the next item.
 *  - learn: a previous item exists AND the next item's chapter differs from the
 *    last completed chapter (the seam).
 *  - revisit: count > 0 and count is a multiple of pauseEvery.
 */
export function shouldPause(mode: SessionMode, opts: ShouldPauseOpts = {}): boolean {
  const s = sessions[mode];
  if (mode === 'learn') {
    if (s.lastChapter === null) return false; // no previous completion yet
    return (opts.nextChapter ?? null) !== s.lastChapter;
  }
  const every = opts.pauseEvery ?? 10;
  return s.count > 0 && s.count % every === 0;
}

/** End the session for a mode — zero the count and clear lastChapter. */
export function reset(mode: SessionMode): void {
  sessions[mode] = { count: 0, lastChapter: null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project client packages/client/tests/unit/lib/session.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/lib/session.ts packages/client/tests/unit/lib/session.test.ts
git commit -m "feat(session): in-memory per-mode session counter + pause rules (TODO 19c)"
```

---

## Task 4: `SessionPause` component (TODO 19d)

**Files:**
- Create: `packages/client/src/components/SessionPause.ts`
- Create: `packages/client/src/components/SessionPause.css`
- Test: `packages/client/tests/integration/SessionPause.test.ts`

> NOTE on the `html` helper: it only supports interpolation at **node/text positions**, never inside an attribute string. So `data-mode` is set via `.dataset.mode` after construction, not `data-mode="${...}"`.

- [ ] **Step 1: Write the failing render test**

Create `packages/client/tests/integration/SessionPause.test.ts`:

```ts
import { describe, test, expect, vi } from 'vitest';
import { SessionPause } from '@/components/SessionPause';

describe('SessionPause', () => {
  test('learn variant: title, count, label, and accent mode', () => {
    const el = SessionPause({
      mode: 'learn',
      count: 5,
      title: 'Chapter 1 done!',
      onContinue: () => {},
      onBreak: () => {},
    });
    expect(el.dataset.mode).toBe('learn');
    expect(el.querySelector('.pause-title')!.textContent).toBe('Chapter 1 done!');
    expect(el.querySelector('.pc-num')!.textContent).toBe('5');
    expect(el.querySelector('.pc-lbl')!.textContent).toBe('problems this session');
  });

  test('revisit variant uses the reviews label and revisit mode', () => {
    const el = SessionPause({
      mode: 'revisit',
      count: 10,
      title: 'Nice — 10 reviews done!',
      onContinue: () => {},
      onBreak: () => {},
    });
    expect(el.dataset.mode).toBe('revisit');
    expect(el.querySelector('.pc-lbl')!.textContent).toBe('reviews this session');
  });

  test('buttons fire their callbacks', () => {
    const onContinue = vi.fn();
    const onBreak = vi.fn();
    const el = SessionPause({ mode: 'learn', count: 1, title: 'x', onContinue, onBreak });
    el.querySelector<HTMLButtonElement>('.pb-continue')!.click();
    el.querySelector<HTMLButtonElement>('.pb-break')!.click();
    expect(onContinue).toHaveBeenCalledOnce();
    expect(onBreak).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project client packages/client/tests/integration/SessionPause.test.ts`
Expected: FAIL — cannot resolve `@/components/SessionPause`.

- [ ] **Step 3: Implement the component**

Create `packages/client/src/components/SessionPause.ts`:

```ts
import { html } from '@/lib/html';
import './SessionPause.css';

export interface SessionPauseProps {
  mode: 'learn' | 'revisit';
  /** Running session count to display in the tally. */
  count: number;
  /** Milestone headline, e.g. "Chapter 1 done!" or "Nice — 10 reviews done!". */
  title: string;
  /** Continue the loop — render the (already-fetched) next item; count NOT reset. */
  onContinue: () => void;
  /** End the session — caller resets the mode and navigates home. */
  onBreak: () => void;
}

/**
 * The session pause checkpoint — a celebratory card shown between items when a
 * boundary is crossed (Learn: a new chapter; Practice: every N reviews). Ports
 * docs/mocks/session-pause.html. Accent (green/purple) is themed by `mode`.
 */
export function SessionPause(props: SessionPauseProps): HTMLElement {
  const countLabel = props.mode === 'learn' ? 'problems this session' : 'reviews this session';
  const sub = props.mode === 'learn'
    ? 'Nice work — take a breather or keep the momentum going.'
    : 'Good rhythm. Rest your brain, or keep clearing the queue.';

  const breakBtn = html`<button class="pause-btn pb-break" type="button">Take a break</button>`;
  const continueBtn = html`<button class="pause-btn pb-continue" type="button">Keep going</button>`;
  breakBtn.addEventListener('click', () => props.onBreak());
  continueBtn.addEventListener('click', () => props.onContinue());

  const card = html`<div class="session-pause animate-in" style="--i: 0">
    <div class="pause-badge" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7" /></svg>
    </div>
    <h1 class="pause-title">${props.title}</h1>
    <p class="pause-sub">${sub}</p>
    <div class="pause-count">
      <span class="pc-num">${props.count}</span>
      <span class="pc-lbl">${countLabel}</span>
    </div>
    <div class="pause-actions">${breakBtn}${continueBtn}</div>
  </div>`;
  card.dataset.mode = props.mode;
  return card;
}
```

- [ ] **Step 4: Implement the styles**

Create `packages/client/src/components/SessionPause.css` (ported from `docs/mocks/session-pause.css`, scoped to `.session-pause`, `practice` → `revisit`, mock-only shell/toggle dropped):

```css
/* Session pause checkpoint card. Lives inside the Learn/Practice scroll area in
   place of the question card. Accent is themed per mode (Learn green / Practice
   purple) from the design tokens. Ported from docs/mocks/session-pause.css. */
.session-pause {
  --accent: var(--learn);
  --accent-dark: var(--learn-dark);
  width: 100%;
  max-width: 30rem;
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.5rem;
}
.session-pause[data-mode="revisit"] {
  --accent: var(--revisit);
  --accent-dark: var(--revisit-dark);
}

/* Check medallion — ties the celebration to the mode accent. */
.pause-badge {
  width: 4.5rem;
  height: 4.5rem;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  background: var(--accent);
  box-shadow: var(--shadow);
  margin-bottom: 0.6rem;
}
.pause-badge svg { width: 2.2rem; height: 2.2rem; display: block; }

.pause-title {
  margin: 0;
  font-size: 1.6rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--fg);
}
.pause-sub {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.4;
  color: var(--muted);
  max-width: 24rem;
}

/* The running session tally. Big number over a quiet label. */
.pause-count {
  margin-top: 1.1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.9rem 1.6rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
}
.pc-num {
  font-size: 2.4rem;
  font-weight: 800;
  line-height: 1;
  color: var(--accent-dark);
}
.pc-lbl {
  margin-top: 0.3rem;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}

/* Actions: two rounded cards side by side. Continue colored (primary), break grey. */
.pause-actions {
  margin-top: 1.4rem;
  width: 100%;
  display: flex;
  gap: 0.7rem;
}
.pause-btn {
  flex: 1;
  border: none;
  font: inherit;
  font-size: 1rem;
  font-weight: 700;
  padding: 0.95rem 1rem;
  border-radius: 16px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  box-shadow: var(--shadow);
  transition: transform 0.08s ease, filter 0.12s ease, box-shadow 0.12s ease;
}
.pause-btn:active { transform: scale(0.97); filter: brightness(0.96); }
@media (hover: hover) {
  .pause-btn:hover { filter: brightness(1.04); }
}
.pb-continue { background: var(--accent); color: #fff; }
.pb-break {
  background: var(--surface);
  color: var(--muted);
  box-shadow: none;
  border: 1px solid var(--border);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --project client packages/client/tests/integration/SessionPause.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/components/SessionPause.ts packages/client/src/components/SessionPause.css packages/client/tests/integration/SessionPause.test.ts
git commit -m "feat(session): SessionPause checkpoint component (TODO 19d)"
```

---

## Task 5: Record completion at grade-save time

**Files:**
- Modify: `packages/client/src/pages/GradePage.ts:1-11` (imports), `:282-292` (boot), `:189-207` (saveAttempt)

> Data flow: a completion is recorded when the grade is saved — the moment an item is truly done (a skip is not a completion). The grade page knows its `from` mode and the question's label.

- [ ] **Step 1: Add imports**

In `packages/client/src/pages/GradePage.ts`, after the existing import block (line 9, the `ImageSourcePicker` import), add:

```ts
import { recordCompleted } from '@/lib/session';
import { splitLabel } from '@/lib/problem-grouping';
```

- [ ] **Step 2: Capture the completed item's chapter in boot**

In `GradePage.ts`, add a closure variable next to the other `let` state (after line 29, `let firstAnswer = '';`):

```ts
  let completedChapter: string | null = null;
```

Then in `boot()`, just after the question JSON is parsed (line 291, `const question = await qRes.json() ...`), add:

```ts
      completedChapter = splitLabel(question.label)?.chapter ?? null;
```

- [ ] **Step 3: Record the completion on successful save**

In `GradePage.ts` `saveAttempt()` (lines 189-207), record before navigating back:

```ts
  async function saveAttempt(rating: Grade) {
    try {
      await fetch(`/api/questions/${questionId}/attempts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answer: firstAnswer,
          recommendedGrade: lastRecommendedGrade,
          rating,
          issues: lastIssues,
        }),
      });
      recordCompleted(from, completedChapter);
      window.location.hash = `#/${from}`;
    } catch {
      const err = ChatBubble('agent');
      err.textContent = 'Failed to save. Try again.';
      chat.append(err);
    }
  }
```

- [ ] **Step 4: Typecheck the client**

Run: `npx tsc -b packages/client`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/pages/GradePage.ts
git commit -m "feat(session): record a completion on grade save (TODO 19c data flow)"
```

---

## Task 6: Learn page — pause on chapter seam (TODO 19a + 19d wiring)

**Files:**
- Modify: `packages/client/src/pages/LearnPage.ts:1-13` (imports), `:70-89` (render)

> The skip path (`loadNext` after a skip) is unchanged — a skip never calls `recordCompleted`, so the count and `lastChapter` are untouched and `shouldPause` behaves correctly after a skip.

- [ ] **Step 1: Add imports**

In `packages/client/src/pages/LearnPage.ts`, after line 7 (`import { stashPhotos } ...`), add:

```ts
import { shouldPause, getCount, getLastChapter, reset } from '@/lib/session';
import { splitLabel } from '@/lib/problem-grouping';
import { SessionPause } from '@/components/SessionPause';
```

- [ ] **Step 2: Replace `render()` with pause-aware render + helpers**

In `LearnPage.ts`, replace the whole `render` function (lines 70-89) with:

```ts
  function render(data: LearnNextResponse) {
    loading = false;
    const { question, book } = data;
    if (!question || !book) {
      reset('learn'); // "All caught up!" is a natural session end — start fresh next visit.
      currentQuestion = null;
      eyebrow.querySelector('span')!.textContent = '';
      qscroll.replaceChildren(html`<div class="learn-empty animate-in" style="--i: 0">All caught up! No new questions to learn.</div>`);
      footer.hidden = true;
      skipBtn.hidden = true;
      return;
    }
    const nextChapter = splitLabel(question.label)?.chapter ?? null;
    if (shouldPause('learn', { nextChapter })) {
      showPause(question, book);
      return;
    }
    renderQuestion(question, book);
  }

  function showPause(question: Question, book: Book) {
    currentQuestion = null; // suppress upload/type/skip while paused
    eyebrow.querySelector('span')!.textContent = '';
    footer.hidden = true;
    skipBtn.hidden = true;
    const pause = SessionPause({
      mode: 'learn',
      count: getCount('learn'),
      title: `Chapter ${getLastChapter('learn')} done!`,
      onContinue: () => renderQuestion(question, book),
      onBreak: () => { reset('learn'); window.location.hash = '#/'; },
    });
    qscroll.replaceChildren(pause);
  }

  function renderQuestion(question: Question, book: Book) {
    currentQuestion = question;
    eyebrow.querySelector('span')!.textContent = `${book.title} · ${question.label}`;
    const card = QuestionCard({ canonicalText: question.canonicalText });
    card.classList.add('animate-in');
    card.style.setProperty('--i', '0');
    qscroll.replaceChildren(card);
    footer.hidden = false;
    skipBtn.hidden = false;
    setActionsEnabled(true);
  }
```

- [ ] **Step 3: Typecheck the client**

Run: `npx tsc -b packages/client`
Expected: exit 0 (`Question` and `Book` interfaces are already declared at the top of the file, lines 11-12).

- [ ] **Step 4: Run the client suite (no regressions)**

Run: `npx vitest run --project client`
Expected: PASS (LandingPage/EditBookPage/ViewBookPage + session + SessionPause all green).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/pages/LearnPage.ts
git commit -m "feat(learn): pause at chapter seams via SessionPause (TODO 19a/19d)"
```

---

## Task 7: Revisit page — pause every N (TODO 19b + 19d + 19e wiring)

**Files:**
- Modify: `packages/client/src/pages/RevisitPage.ts:1-13` (imports), `:17` (state), `:69-88` (render), `:114` (mount)

> `pauseEvery` is fetched once on mount. The first item never pauses (count starts at 0), and the count only reaches `pauseEvery` after at least one full grade round-trip, by which time the settings fetch has resolved — so a slow settings fetch can never strand the first pause. If the fetch fails, the default 10 is used.

- [ ] **Step 1: Add imports**

In `packages/client/src/pages/RevisitPage.ts`, after line 7 (`import { stashPhotos } ...`), add:

```ts
import { shouldPause, getCount, reset } from '@/lib/session';
import { SessionPause } from '@/components/SessionPause';
```

- [ ] **Step 2: Add the `pauseEvery` page state + fetch on mount**

In `RevisitPage.ts`, inside `RevisitPage()` after the existing state (after line 17, `let loading = false;`), add:

```ts
  let pauseEvery = 10;
```

Then replace the mount line at the bottom (line 114, `void loadNext();`) with the settings fetch followed by the first load:

```ts
  void fetch('/api/settings')
    .then((r) => (r.ok ? (r.json() as Promise<{ pauseEvery?: number }>) : null))
    .then((s) => { if (s && typeof s.pauseEvery === 'number') pauseEvery = s.pauseEvery; })
    .catch(() => { /* keep the default 10 */ });
  void loadNext();
```

- [ ] **Step 3: Replace `render()` with pause-aware render + helpers**

In `RevisitPage.ts`, replace the whole `render` function (lines 69-88) with:

```ts
  function render(item: DueItem | null) {
    loading = false;
    if (!item) {
      reset('revisit'); // "All caught up!" is a natural session end.
      currentQuestion = null;
      eyebrow.querySelector('span')!.textContent = '';
      qscroll.replaceChildren(html`<div class="learn-empty animate-in" style="--i: 0">All caught up! Nothing to revisit.</div>`);
      footer.hidden = true;
      skipBtn.hidden = true;
      return;
    }
    if (shouldPause('revisit', { pauseEvery })) {
      showPause(item);
      return;
    }
    renderQuestion(item);
  }

  function showPause(item: DueItem) {
    currentQuestion = null; // suppress upload/type/skip while paused
    eyebrow.querySelector('span')!.textContent = '';
    footer.hidden = true;
    skipBtn.hidden = true;
    const pause = SessionPause({
      mode: 'revisit',
      count: getCount('revisit'),
      title: `Nice — ${getCount('revisit')} reviews done!`,
      onContinue: () => renderQuestion(item),
      onBreak: () => { reset('revisit'); window.location.hash = '#/'; },
    });
    qscroll.replaceChildren(pause);
  }

  function renderQuestion(item: DueItem) {
    currentQuestion = item.question;
    eyebrow.querySelector('span')!.textContent = `${item.book.title} · ${item.question.label}`;
    const card = QuestionCard({ canonicalText: item.question.canonicalText });
    card.classList.add('animate-in');
    card.style.setProperty('--i', '0');
    qscroll.replaceChildren(card);
    footer.hidden = false;
    skipBtn.hidden = false;
    setActionsEnabled(true);
  }
```

- [ ] **Step 4: Typecheck the client**

Run: `npx tsc -b packages/client`
Expected: exit 0 (`DueItem` is declared at line 13).

- [ ] **Step 5: Run the full client + server suites**

Run: `npx vitest run --project client && npx vitest run --project server`
Expected: PASS for both.

- [ ] **Step 6: Manual verification (per the spec's testing section)**

Start the app (`npm run dev` per repo convention), then:
1. **Learn across a chapter boundary:** complete every problem in chapter 1; when the next item is chapter 2 the green pause appears with "Chapter 1 done!" and the running count. "Keep going" shows the chapter-2 item and the count keeps climbing; "Take a break" returns home and a re-entry starts the count at 0.
2. **Practice every N:** set "Pause every" to a small number (e.g. 3) on the Settings page, save, then do Practice — the purple pause appears after every 3 reviews with "Nice — N reviews done!".
3. **Caught up:** clear a queue to confirm "All caught up!" appears and the next visit's count starts fresh.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/pages/RevisitPage.ts
git commit -m "feat(practice): pause every N reviews via SessionPause (TODO 19b/19d/19e)"
```

---

## Task 8: Archive the TODO items

**Files:**
- Modify: `TODO.md` (section 19), `DONE.md`

- [ ] **Step 1: Move section 19 to DONE.md**

Mark `19a`–`19e` `(done)` and move the `19.` block from `TODO.md` into `DONE.md` (placed next to the other completed feature sections), following the existing archive convention. Leave the section header prose in `TODO.md` intact.

- [ ] **Step 2: Commit**

```bash
git add TODO.md DONE.md
git commit -m "docs(todo): archive completed session-looping work (19a-e) to DONE.md"
```

---

## Self-Review Notes

- **Spec coverage:** 19c → Task 3 (`session.ts`); 19d → Task 4 (`SessionPause`) + Tasks 6/7 (wiring); 19e → Task 1 (server) + Task 2 (Settings UI); data flow (record at grade save) → Task 5; per-mode accent + labels → Task 4; reset on "Take a break" and on "All caught up!" → Tasks 6/7; pure-logic tests + api-uat + manual → Tasks 3/1/7. 19a/19b looping pre-existed and is reused unchanged.
- **`html` attribute caveat:** `data-mode` is set via `.dataset.mode`, never interpolated into the attribute string (Task 4 note).
- **Activity untouched:** `customerGoals` keeps the `{ daysGoal, problemsGoal }` shape; only `customerSettings` carries `pauseEvery`, so activity tests are unaffected (Task 1).
- **Type consistency:** `recordCompleted`, `getCount`, `getLastChapter`, `shouldPause`, `reset`, `SessionMode`, `ShouldPauseOpts`, `SessionPauseProps`, `customerSettings`, `SettingsView`, `DEFAULT_PAUSE_EVERY` are defined once and used with the same signatures across tasks.
