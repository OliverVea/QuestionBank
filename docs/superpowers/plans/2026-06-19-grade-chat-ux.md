# Grade Chat UX Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `GradePage` as a render-from-state chat with a two-step photo flow — a conversational *transcription* chat (correct → AI re-reads) followed by a separate *grading* chat seeded with the confirmed reading — plus inline edit-and-revert, compose-while-busy, and fixed scroll behavior.

**Architecture:** A pure `Conversation` model is the single source of truth; one `render()` rebuilds the message list from it. Edit/revert, regrade, and the transcription→grading handoff all reduce to "mutate the model → `render()`". The page is a thin orchestrator over dumb bubble components (data → DOM) and a typed `grade-api` network layer. No server changes — the existing `/transcribe`, `/transcribe/retry`, `/grade`, `/attempts`, `/skip` endpoints already support everything.

**Tech Stack:** TypeScript, Vite, vitest (jsdom for client), the repo's `html` tagged-template helper, KaTeX via `renderLatex`. No framework.

**Design source of truth:** the approved mock at `docs/mocks/grade.html` + `docs/mocks/grade.css`. This plan ports it 1:1 to real components.

**Deviations from the original spec** (`docs/superpowers/specs/2026-06-18-grade-chat-ux-design.md`) — agreed during the mock walkthrough, this plan supersedes the spec where they differ:
- Photo flow is **two sequential chats** (transcription, then grading), **not** one conversation with a transcription-review panel. Transcription is **conversational** (multi-turn re-reads via `/transcribe/retry`), not a single editable textarea.
- The engineering-pad **grid background is gone** (already removed from prod in commit `820d21e`).
- A **"Step 1 of 2 / Step 2 of 2" phase bar** appears in the photo flow only.

**Out of scope:** migrating `ScanProblemsPage` to render-from-state (it keeps its current behavior; we only *extend* the shared components it uses, never break their existing API). Persisting the full critique transcript on the Attempt (TODO 3b). Any server change.

---

## File Structure

**New files (client):**
- `packages/client/src/pages/grade/conversation.ts` — pure model: turns, add/edit/truncate, `firstAnswer`, `latestGrade`, `toGradePayload()`. Unit-tested.
- `packages/client/src/pages/grade/grade-api.ts` — typed network wrappers: `transcribe`, `retranscribe`, `grade`, `saveAttempt`, `skip`.
- `packages/client/src/pages/grade/GraderBubble.ts` — grade payload → bubble DOM.
- `packages/client/src/pages/grade/UserBubble.ts` — user turn → bubble DOM, display + inline-edit modes.
- `packages/client/src/pages/grade/ReadingBubble.ts` — a transcription reading → bubble DOM.
- `packages/client/src/components/PhotoBubble.ts` (+`.css`) — photo thumbnails as a user bubble (shared).

**Modified files (client):**
- `packages/client/src/components/ChatContainer.ts` — add `scrollToTop()`, `scrollToNode(node)`, `clear()` (keep `append`, `scrollToBottom`).
- `packages/client/src/components/ReplyRow.ts` — add `setSending(busy)`, `setPlaceholder(text)` (keep `disable`/`enable` — ScanProblemsPage uses them).
- `packages/client/src/pages/GradePage.ts` — full rewrite as the orchestrator.
- `packages/client/src/pages/GradePage.css` — rewrite to match the mock (phase bar, reading bubble, advance button, edit affordance/editor; drop photo-capture panel styles only if unused).

**New test files:**
- `packages/client/tests/unit/pages/grade/conversation.test.ts`
- `packages/client/tests/unit/pages/grade/grade-api.test.ts`
- `packages/client/tests/unit/pages/grade/GraderBubble.test.ts`
- `packages/client/tests/unit/pages/grade/UserBubble.test.ts`
- `packages/client/tests/unit/pages/grade/ReadingBubble.test.ts`
- `packages/client/tests/unit/components/PhotoBubble.test.ts`
- `packages/client/tests/integration/GradePage.test.ts`

**Test commands:**
- Single client test file: `npx vitest run --project client <path>`
- All client tests: `npm run test:client`
- Typecheck: `npm run typecheck`

---

## Conventions for every task

- Write the test first, run it red, implement, run it green, commit.
- Stage files by **exact path** (`git add <path> <path>`). Never `git add -A`. Never stage `.claude/settings.local.json`.
- Commit messages end with the repo's `Co-Authored-By` trailer (see other commits).

---

### Task 1: `conversation.ts` — the model

**Files:**
- Create: `packages/client/src/pages/grade/conversation.ts`
- Test: `packages/client/tests/unit/pages/grade/conversation.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/client/tests/unit/pages/grade/conversation.test.ts
import { describe, test, expect } from 'vitest';
import { Conversation } from '@/pages/grade/conversation';
import type { GradePayload } from '@/pages/grade/conversation';

const grade = (g: GradePayload['recommendedGrade']): GradePayload => ({
  reasoning: 'r', issues: [], recommendedGrade: g,
});

describe('Conversation', () => {
  test('starts empty', () => {
    const c = new Conversation();
    expect(c.turns).toEqual([]);
    expect(c.firstAnswer).toBe('');
    expect(c.latestGrade).toBeNull();
    expect(c.toGradePayload()).toEqual([]);
  });

  test('addUser/addGrade build an alternating wire payload', () => {
    const c = new Conversation();
    const id = c.addUser('x = 4');
    expect(id).toBe(1);
    const g = grade('partial');
    c.addGrade(g);
    expect(c.firstAnswer).toBe('x = 4');
    expect(c.latestGrade).toEqual(g);
    expect(c.toGradePayload()).toEqual([
      { role: 'user', text: 'x = 4' },
      { role: 'assistant', text: JSON.stringify(g) },
    ]);
  });

  test('editUserTurn rewrites the turn and truncates everything after it', () => {
    const c = new Conversation();
    const a = c.addUser('A');
    c.addGrade(grade('partial'));
    c.addUser('B');
    c.addGrade(grade('correct'));
    expect(c.turns).toHaveLength(4);

    c.editUserTurn(a, 'A2');
    expect(c.turns).toHaveLength(1);
    expect(c.firstAnswer).toBe('A2');
    expect(c.latestGrade).toBeNull();
  });

  test('editUserTurn on an unknown id is a no-op', () => {
    const c = new Conversation();
    c.addUser('A');
    c.editUserTurn(999, 'nope');
    expect(c.turns).toHaveLength(1);
    expect(c.firstAnswer).toBe('A');
  });

  test('reading and photo turns are ignored by the grade payload', () => {
    const c = new Conversation();
    c.addPhoto('my notes');
    c.addReading('the reading');
    expect(c.toGradePayload()).toEqual([]);
    expect(c.firstAnswer).toBe('');
  });

  test('clear resets turns but keeps issuing fresh ids', () => {
    const c = new Conversation();
    c.addUser('A');
    c.clear();
    expect(c.turns).toEqual([]);
    const id = c.addUser('B');
    expect(id).toBe(2); // ids never collide across a clear
  });
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run --project client packages/client/tests/unit/pages/grade/conversation.test.ts`
Expected: FAIL — cannot resolve `@/pages/grade/conversation`.

- [ ] **Step 3: Implement**

```typescript
// packages/client/src/pages/grade/conversation.ts
export type Grade = 'correct' | 'partial' | 'incorrect';
export type IssueSeverity = 'critical' | 'medium' | 'minor';

export interface GradingIssue { severity: IssueSeverity; description: string }
export interface GradePayload {
  reasoning: string;
  issues: GradingIssue[];
  recommendedGrade: Grade;
}

export type Turn =
  | { id: number; role: 'user'; kind: 'text'; text: string }
  | { id: number; role: 'user'; kind: 'photo'; notes: string }
  | { id: number; role: 'assistant'; kind: 'reading'; text: string }
  | { id: number; role: 'assistant'; kind: 'grade'; payload: GradePayload };

export interface ApiTurn { role: 'user' | 'assistant'; text: string }

/**
 * The grade page's source of truth. Pure — no DOM, no fetch. The orchestrator
 * mutates it and calls render(); the photo flow clears it on the handoff from
 * the transcription chat to the grading chat.
 */
export class Conversation {
  private _turns: Turn[] = [];
  private nextId = 1;

  get turns(): readonly Turn[] { return this._turns; }

  /** First user *text* turn — the answer recorded on the Attempt. */
  get firstAnswer(): string {
    const t = this._turns.find((x) => x.role === 'user' && x.kind === 'text');
    return t && t.kind === 'text' ? t.text : '';
  }

  /** Most recent grader payload, or null if not graded yet. */
  get latestGrade(): GradePayload | null {
    for (let i = this._turns.length - 1; i >= 0; i--) {
      const t = this._turns[i];
      if (t.kind === 'grade') return t.payload;
    }
    return null;
  }

  addUser(text: string): number {
    const id = this.nextId++;
    this._turns.push({ id, role: 'user', kind: 'text', text });
    return id;
  }

  addPhoto(notes: string): number {
    const id = this.nextId++;
    this._turns.push({ id, role: 'user', kind: 'photo', notes });
    return id;
  }

  addReading(text: string): number {
    const id = this.nextId++;
    this._turns.push({ id, role: 'assistant', kind: 'reading', text });
    return id;
  }

  addGrade(payload: GradePayload): number {
    const id = this.nextId++;
    this._turns.push({ id, role: 'assistant', kind: 'grade', payload });
    return id;
  }

  /** Rewrite a user text turn and drop every turn after it (revert to here). */
  editUserTurn(id: number, text: string): void {
    const idx = this._turns.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const turn = this._turns[idx];
    if (turn.role !== 'user' || turn.kind !== 'text') return;
    this._turns[idx] = { ...turn, text };
    this._turns.length = idx + 1;
  }

  clear(): void { this._turns = []; }

  /** Wire shape for POST /grade: user text + assistant grade turns only. */
  toGradePayload(): ApiTurn[] {
    const out: ApiTurn[] = [];
    for (const t of this._turns) {
      if (t.role === 'user' && t.kind === 'text') out.push({ role: 'user', text: t.text });
      else if (t.kind === 'grade') out.push({ role: 'assistant', text: JSON.stringify(t.payload) });
    }
    return out;
  }
}
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run --project client packages/client/tests/unit/pages/grade/conversation.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/pages/grade/conversation.ts packages/client/tests/unit/pages/grade/conversation.test.ts
git commit -m "feat(grade): pure Conversation model for the grade chat"
```

---

### Task 2: `grade-api.ts` — typed network layer

**Files:**
- Create: `packages/client/src/pages/grade/grade-api.ts`
- Test: `packages/client/tests/unit/pages/grade/grade-api.test.ts`

Server contracts (confirmed): `POST /api/questions/:id/transcribe` (multipart `images[]`,`notes`) → `{ transcription }`; `POST /api/questions/:id/transcribe/retry` (multipart `images[]`,`currentTranscription`,`correctionNote`) → `{ transcription }`; `POST /api/questions/:id/grade` (`{ conversation }`) → `{ reasoning, issues, recommendedGrade }`; `POST /api/questions/:id/attempts`; `POST /api/skip/:id`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/client/tests/unit/pages/grade/grade-api.test.ts
import { describe, test, expect, vi, afterEach } from 'vitest';
import * as api from '@/pages/grade/grade-api';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
afterEach(() => vi.unstubAllGlobals());

const png = () => new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });

describe('grade-api', () => {
  test('transcribe posts multipart and returns the string', async () => {
    const fn = mockFetch(200, { transcription: 'x = 4' });
    const out = await api.transcribe('q1', [png()], 'note');
    expect(out).toBe('x = 4');
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/questions/q1/transcribe');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('notes')).toBe('note');
  });

  test('retranscribe posts the current transcription + correction note', async () => {
    const fn = mockFetch(200, { transcription: 'x = 1' });
    const out = await api.retranscribe('q1', [png()], 'x = 7', 'that 7 is a 1');
    expect(out).toBe('x = 1');
    const body = fn.mock.calls[0][1].body as FormData;
    expect(fn.mock.calls[0][0]).toBe('/api/questions/q1/transcribe/retry');
    expect(body.get('currentTranscription')).toBe('x = 7');
    expect(body.get('correctionNote')).toBe('that 7 is a 1');
  });

  test('grade posts the conversation as JSON and returns the payload', async () => {
    const payload = { reasoning: 'r', issues: [], recommendedGrade: 'correct' };
    const fn = mockFetch(200, payload);
    const out = await api.grade('q1', [{ role: 'user', text: 'x = 4' }]);
    expect(out).toEqual(payload);
    const init = fn.mock.calls[0][1];
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ conversation: [{ role: 'user', text: 'x = 4' }] });
  });

  test('a non-ok response throws', async () => {
    mockFetch(502, {});
    await expect(api.grade('q1', [{ role: 'user', text: 'x' }])).rejects.toThrow();
  });

  test('saveAttempt and skip post JSON / no body', async () => {
    const fn = mockFetch(201, {});
    await api.saveAttempt('q1', { answer: 'a', recommendedGrade: 'correct', rating: 'correct', issues: [] });
    expect(fn.mock.calls[0][0]).toBe('/api/questions/q1/attempts');
    await api.skip('q1');
    expect(fn.mock.calls[1][0]).toBe('/api/skip/q1');
  });
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run --project client packages/client/tests/unit/pages/grade/grade-api.test.ts`
Expected: FAIL — cannot resolve `@/pages/grade/grade-api`.

- [ ] **Step 3: Implement**

```typescript
// packages/client/src/pages/grade/grade-api.ts
import type { ApiTurn, Grade, GradePayload, GradingIssue } from './conversation';

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function transcribe(questionId: string, files: File[], notes: string): Promise<string> {
  const form = new FormData();
  for (const f of files) form.append('images', f);
  if (notes) form.append('notes', notes);
  const res = await fetch(`/api/questions/${questionId}/transcribe`, { method: 'POST', body: form });
  const { transcription } = await jsonOrThrow<{ transcription: string }>(res);
  return transcription;
}

export async function retranscribe(
  questionId: string, files: File[], currentTranscription: string, correctionNote: string,
): Promise<string> {
  const form = new FormData();
  for (const f of files) form.append('images', f);
  form.append('currentTranscription', currentTranscription);
  form.append('correctionNote', correctionNote);
  const res = await fetch(`/api/questions/${questionId}/transcribe/retry`, { method: 'POST', body: form });
  const { transcription } = await jsonOrThrow<{ transcription: string }>(res);
  return transcription;
}

export async function grade(questionId: string, conversation: ApiTurn[]): Promise<GradePayload> {
  const res = await fetch(`/api/questions/${questionId}/grade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation }),
  });
  return jsonOrThrow<GradePayload>(res);
}

export async function saveAttempt(
  questionId: string,
  body: { answer: string; recommendedGrade: Grade; rating: Grade; issues: GradingIssue[] },
): Promise<void> {
  const res = await fetch(`/api/questions/${questionId}/attempts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`save failed: ${res.status}`);
}

export async function skip(questionId: string): Promise<void> {
  const res = await fetch(`/api/skip/${questionId}`, { method: 'POST' });
  if (!res.ok) throw new Error(`skip failed: ${res.status}`);
}
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run --project client packages/client/tests/unit/pages/grade/grade-api.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/pages/grade/grade-api.ts packages/client/tests/unit/pages/grade/grade-api.test.ts
git commit -m "feat(grade): typed grade-api network layer (transcribe/retry/grade/attempt/skip)"
```

---

### Task 3: Extend `ChatContainer` with scroll/clear helpers

**Files:**
- Modify: `packages/client/src/components/ChatContainer.ts`
- Test: `packages/client/tests/unit/components/ChatContainer.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/client/tests/unit/components/ChatContainer.test.ts
import { describe, test, expect } from 'vitest';
import { ChatContainer } from '@/components/ChatContainer';

describe('ChatContainer', () => {
  test('clear() removes all children', () => {
    const c = ChatContainer();
    c.el.appendChild(document.createElement('div'));
    c.el.appendChild(document.createElement('div'));
    expect(c.el.children).toHaveLength(2);
    c.clear();
    expect(c.el.children).toHaveLength(0);
  });

  test('scrollToTop sets scrollTop to 0', () => {
    const c = ChatContainer();
    c.el.scrollTop = 50;
    c.scrollToTop();
    expect(c.el.scrollTop).toBe(0);
  });

  test('scrollToNode exists and does not throw on a child node', () => {
    const c = ChatContainer();
    const node = document.createElement('div');
    c.el.appendChild(node);
    expect(() => c.scrollToNode(node)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run --project client packages/client/tests/unit/components/ChatContainer.test.ts`
Expected: FAIL — `c.clear is not a function`.

- [ ] **Step 3: Implement** — replace the file body

```typescript
// packages/client/src/components/ChatContainer.ts
import { html } from '@/lib/html';
import './ChatContainer.css';

export interface ChatContainerHandle {
  el: HTMLElement;
  append(node: Node): void;
  clear(): void;
  scrollToTop(): void;
  scrollToBottom(): void;
  scrollToNode(node: HTMLElement): void;
}

/** Scrollable chat message area with append + scroll utilities. */
export function ChatContainer(): ChatContainerHandle {
  const el = html`<main class="chat-container"></main>`;
  return {
    el,
    append(node: Node) {
      el.appendChild(node);
      el.scrollTop = el.scrollHeight;
    },
    clear() { el.replaceChildren(); },
    scrollToTop() { el.scrollTop = 0; },
    scrollToBottom() { el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); },
    // Land the top of a reply in view (so a long reply reads from its start)
    // instead of dropping past it. Small offset for breathing room.
    scrollToNode(node: HTMLElement) {
      el.scrollTo({ top: Math.max(0, node.offsetTop - 8), behavior: 'smooth' });
    },
  };
}
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run --project client packages/client/tests/unit/components/ChatContainer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/ChatContainer.ts packages/client/tests/unit/components/ChatContainer.test.ts
git commit -m "feat(components): add clear/scrollToTop/scrollToNode to ChatContainer"
```

---

### Task 4: Extend `ReplyRow` with `setSending` / `setPlaceholder`

Keep `disable()`/`enable()` — `ScanProblemsPage` calls them.

**Files:**
- Modify: `packages/client/src/components/ReplyRow.ts`
- Test: `packages/client/tests/unit/components/ReplyRow.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/client/tests/unit/components/ReplyRow.test.ts
import { describe, test, expect, vi } from 'vitest';
import { ReplyRow } from '@/components/ReplyRow';

function parts(handle: { el: HTMLElement }) {
  return {
    input: handle.el.querySelector('textarea') as HTMLTextAreaElement,
    send: handle.el.querySelector('.reply-send') as HTMLButtonElement,
  };
}

describe('ReplyRow', () => {
  test('setSending locks only the send button; textarea stays editable', () => {
    const r = ReplyRow({ onSend: () => {} });
    const { input, send } = parts(r);
    r.setSending(true);
    expect(send.disabled).toBe(true);
    expect(input.disabled).toBe(false);
    r.setSending(false);
    expect(send.disabled).toBe(false);
  });

  test('setPlaceholder updates the textarea placeholder', () => {
    const r = ReplyRow({ onSend: () => {} });
    r.setPlaceholder('Tell me what to fix…');
    expect(parts(r).input.placeholder).toBe('Tell me what to fix…');
  });

  test('Enter sends, Shift+Enter does not', () => {
    const onSend = vi.fn();
    const r = ReplyRow({ onSend });
    const { input } = parts(r);
    input.value = 'hello';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSend).toHaveBeenCalledWith('hello');
  });
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run --project client packages/client/tests/unit/components/ReplyRow.test.ts`
Expected: FAIL — `r.setSending is not a function`.

- [ ] **Step 3: Implement** — replace the file body

```typescript
// packages/client/src/components/ReplyRow.ts
import { html } from '@/lib/html';
import './ReplyRow.css';

export interface ReplyRowHandle {
  el: HTMLElement;
  focus(): void;
  disable(): void;
  enable(): void;
  /** Compose-while-busy: lock only the send button; textarea stays editable. */
  setSending(busy: boolean): void;
  setPlaceholder(text: string): void;
}

/** Reply row: auto-growing textarea + send button. Enter to send, Shift+Enter for newline. */
export function ReplyRow(opts: { placeholder?: string; onSend: (text: string) => void }): ReplyRowHandle {
  const input = document.createElement('textarea');
  input.className = 'reply-input';
  input.rows = 1;
  input.placeholder = opts.placeholder ?? 'Type a message…';

  const sendBtn = html`<button class="reply-send" type="button" aria-label="Send">→</button>`;

  function send() {
    const text = input.value.trim();
    if (!text) return;
    opts.onSend(text);
    input.value = '';
    input.style.height = 'auto';
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  const el = html`<div class="reply-row">${input}${sendBtn}</div>`;
  const send_ = sendBtn as HTMLButtonElement;

  return {
    el,
    focus() { input.focus(); },
    disable() { input.disabled = true; send_.disabled = true; },
    enable() { input.disabled = false; send_.disabled = false; },
    setSending(busy: boolean) { send_.disabled = busy; },
    setPlaceholder(text: string) { input.placeholder = text; },
  };
}
```

- [ ] **Step 4: Run green + confirm ScanProblemsPage still typechecks**

Run: `npx vitest run --project client packages/client/tests/unit/components/ReplyRow.test.ts`
Expected: PASS (3 tests).
Run: `npm run typecheck`
Expected: exit 0 (ScanProblemsPage still uses `disable`/`enable`, which remain).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/ReplyRow.ts packages/client/tests/unit/components/ReplyRow.test.ts
git commit -m "feat(components): add setSending/setPlaceholder to ReplyRow (keep disable/enable)"
```

---

### Task 5: `PhotoBubble` component

**Files:**
- Create: `packages/client/src/components/PhotoBubble.ts`, `packages/client/src/components/PhotoBubble.css`
- Test: `packages/client/tests/unit/components/PhotoBubble.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/client/tests/unit/components/PhotoBubble.test.ts
import { describe, test, expect, beforeAll } from 'vitest';
import { PhotoBubble } from '@/components/PhotoBubble';

beforeAll(() => {
  // jsdom has no object URLs
  globalThis.URL.createObjectURL = () => 'blob:fake';
});

const png = () => new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });

describe('PhotoBubble', () => {
  test('renders one thumbnail per file as a user bubble', () => {
    const el = PhotoBubble([png(), png()]);
    expect(el.classList.contains('chat-bubble-user')).toBe(true);
    expect(el.classList.contains('photo-bubble')).toBe(true);
    expect(el.querySelectorAll('img.photo-thumb')).toHaveLength(2);
  });

  test('renders notes when provided', () => {
    const el = PhotoBubble([png()], { notes: 'see line 2' });
    expect(el.querySelector('.photo-notes-text')?.textContent).toBe('see line 2');
  });
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run --project client packages/client/tests/unit/components/PhotoBubble.test.ts`
Expected: FAIL — cannot resolve `@/components/PhotoBubble`.

- [ ] **Step 3: Implement**

```typescript
// packages/client/src/components/PhotoBubble.ts
import './PhotoBubble.css';

/** Photo thumbnails shown as a user chat bubble. */
export function PhotoBubble(files: File[], opts: { notes?: string } = {}): HTMLElement {
  const el = document.createElement('div');
  el.className = 'chat-bubble chat-bubble-user photo-bubble';
  for (const file of files) {
    const img = document.createElement('img');
    img.className = 'photo-thumb';
    img.src = URL.createObjectURL(file);
    img.alt = 'Your solution';
    el.appendChild(img);
  }
  if (opts.notes) {
    const note = document.createElement('div');
    note.className = 'photo-notes-text';
    note.textContent = opts.notes;
    el.appendChild(note);
  }
  return el;
}
```

```css
/* packages/client/src/components/PhotoBubble.css */
.photo-bubble { padding: 0.4rem; display: flex; flex-direction: row; flex-wrap: wrap; align-items: flex-start; gap: 0.4rem; }
.photo-thumb {
  display: block;
  width: 100%;
  max-width: 140px;
  max-height: 200px;
  object-fit: cover;
  border-radius: 11px;
}
.photo-notes-text { width: 100%; font-size: 0.85rem; color: var(--muted); font-style: italic; margin-top: 0.3rem; }
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run --project client packages/client/tests/unit/components/PhotoBubble.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/PhotoBubble.ts packages/client/src/components/PhotoBubble.css packages/client/tests/unit/components/PhotoBubble.test.ts
git commit -m "feat(components): PhotoBubble — photo thumbnails as a user bubble"
```

---

### Task 6: `ReadingBubble` component

**Files:**
- Create: `packages/client/src/pages/grade/ReadingBubble.ts`
- Test: `packages/client/tests/unit/pages/grade/ReadingBubble.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/client/tests/unit/pages/grade/ReadingBubble.test.ts
import { describe, test, expect } from 'vitest';
import { ReadingBubble } from '@/pages/grade/ReadingBubble';

describe('ReadingBubble', () => {
  test('renders an agent bubble with a label and the reading text', () => {
    const el = ReadingBubble('x = 4 and y = 2');
    expect(el.classList.contains('chat-bubble-agent')).toBe(true);
    expect(el.classList.contains('reading-bubble')).toBe(true);
    expect(el.querySelector('.reading-label')?.textContent).toBe("Here's what I read");
    expect(el.textContent).toContain('x = 4');
  });
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run --project client packages/client/tests/unit/pages/grade/ReadingBubble.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement**

```typescript
// packages/client/src/pages/grade/ReadingBubble.ts
import { renderLatex } from '@/lib/latex';

/** A transcription reading shown as a plain agent bubble. */
export function ReadingBubble(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'chat-bubble chat-bubble-agent reading-bubble';

  const label = document.createElement('div');
  label.className = 'reading-label';
  label.textContent = "Here's what I read";
  el.appendChild(label);

  const body = document.createElement('div');
  renderLatex(body, text);
  el.appendChild(body);
  return el;
}
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run --project client packages/client/tests/unit/pages/grade/ReadingBubble.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/pages/grade/ReadingBubble.ts packages/client/tests/unit/pages/grade/ReadingBubble.test.ts
git commit -m "feat(grade): ReadingBubble for transcription readings"
```

---

### Task 7: `GraderBubble` component

Ports `renderGraderBubble` from the current GradePage (badge/issues/reasoning).

**Files:**
- Create: `packages/client/src/pages/grade/GraderBubble.ts`
- Test: `packages/client/tests/unit/pages/grade/GraderBubble.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/client/tests/unit/pages/grade/GraderBubble.test.ts
import { describe, test, expect } from 'vitest';
import { GraderBubble } from '@/pages/grade/GraderBubble';
import type { GradePayload } from '@/pages/grade/conversation';

const base = (over: Partial<GradePayload> = {}): GradePayload => ({
  reasoning: 'because', issues: [], recommendedGrade: 'correct', ...over,
});

describe('GraderBubble', () => {
  test('no issues → grade badge + "no issues" line', () => {
    const el = GraderBubble(base());
    expect(el.querySelector('.grade-badge')?.textContent).toBe('correct');
    expect(el.querySelector('.grade-ok')).not.toBeNull();
    expect(el.querySelector('.issue-list')).toBeNull();
  });

  test('issues → one row per issue with severity + description', () => {
    const el = GraderBubble(base({
      recommendedGrade: 'partial',
      issues: [
        { severity: 'critical', description: 'missing d' },
        { severity: 'minor', description: 'justify denominator' },
      ],
    }));
    expect(el.querySelector('.grade-badge')?.textContent).toBe('partial');
    expect(el.querySelectorAll('.issue')).toHaveLength(2);
    expect(el.querySelector('.issue-critical .issue-sev')?.textContent).toBe('critical');
    expect(el.textContent).toContain('missing d');
  });

  test('reasoning is in a collapsed details element', () => {
    const el = GraderBubble(base());
    const det = el.querySelector('details.reasoning') as HTMLDetailsElement;
    expect(det).not.toBeNull();
    expect(det.open).toBe(false);
    expect(det.textContent).toContain('because');
  });
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run --project client packages/client/tests/unit/pages/grade/GraderBubble.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement**

```typescript
// packages/client/src/pages/grade/GraderBubble.ts
import { renderLatex } from '@/lib/latex';
import type { GradePayload } from './conversation';

/** Grader payload → bubble DOM (badge / issues / collapsible reasoning). */
export function GraderBubble(p: GradePayload): HTMLElement {
  const el = document.createElement('div');
  el.className = 'chat-bubble chat-bubble-agent';

  const badge = document.createElement('span');
  badge.className = `grade-badge grade-${p.recommendedGrade}`;
  badge.textContent = p.recommendedGrade;
  el.appendChild(badge);

  if (p.issues.length === 0) {
    const ok = document.createElement('div');
    ok.className = 'grade-ok';
    ok.textContent = 'No issues found — looks correct.';
    el.appendChild(ok);
  } else {
    const list = document.createElement('ul');
    list.className = 'issue-list';
    for (const issue of p.issues) {
      const li = document.createElement('li');
      li.className = `issue issue-${issue.severity}`;
      const sev = document.createElement('span');
      sev.className = 'issue-sev';
      sev.textContent = issue.severity;
      const desc = document.createElement('span');
      desc.className = 'issue-desc';
      renderLatex(desc, issue.description);
      li.append(sev, desc);
      list.appendChild(li);
    }
    el.appendChild(list);
  }

  const det = document.createElement('details');
  det.className = 'reasoning';
  const sum = document.createElement('summary');
  sum.textContent = 'Show reasoning';
  const rb = document.createElement('div');
  rb.className = 'reasoning-body';
  renderLatex(rb, p.reasoning);
  det.append(sum, rb);
  el.appendChild(det);

  return el;
}
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run --project client packages/client/tests/unit/pages/grade/GraderBubble.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/pages/grade/GraderBubble.ts packages/client/tests/unit/pages/grade/GraderBubble.test.ts
git commit -m "feat(grade): GraderBubble component (extracted from GradePage)"
```

---

### Task 8: `UserBubble` component (display + inline edit)

**Files:**
- Create: `packages/client/src/pages/grade/UserBubble.ts`
- Test: `packages/client/tests/unit/pages/grade/UserBubble.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/client/tests/unit/pages/grade/UserBubble.test.ts
import { describe, test, expect, vi } from 'vitest';
import { UserBubble } from '@/pages/grade/UserBubble';

describe('UserBubble', () => {
  test('display mode shows the text and an Edit affordance when editable', () => {
    const onEdit = vi.fn();
    const el = UserBubble({ id: 1, text: 'x = 4' }, { editable: true, editing: false, onEdit, onSave: () => {}, onCancel: () => {} });
    expect(el.classList.contains('chat-bubble-user')).toBe(true);
    expect(el.textContent).toContain('x = 4');
    const edit = el.querySelector('.bubble-edit') as HTMLButtonElement;
    expect(edit).not.toBeNull();
    edit.click();
    expect(onEdit).toHaveBeenCalledWith(1);
  });

  test('no Edit affordance when not editable', () => {
    const el = UserBubble({ id: 1, text: 'x = 4' }, { editable: false, editing: false, onEdit: () => {}, onSave: () => {}, onCancel: () => {} });
    expect(el.querySelector('.bubble-edit')).toBeNull();
  });

  test('editing mode shows a textarea + Save/Cancel and wires them', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const el = UserBubble({ id: 1, text: 'x = 4' }, { editable: true, editing: true, onEdit: () => {}, onSave, onCancel });
    const ta = el.querySelector('textarea.bubble-editor') as HTMLTextAreaElement;
    expect(ta.value).toBe('x = 4');
    ta.value = 'x = 5';
    (el.querySelector('.bubble-save') as HTMLButtonElement).click();
    expect(onSave).toHaveBeenCalledWith(1, 'x = 5');
    (el.querySelector('.bubble-cancel') as HTMLButtonElement).click();
    expect(onCancel).toHaveBeenCalled();
  });

  test('Save with empty text does not fire onSave', () => {
    const onSave = vi.fn();
    const el = UserBubble({ id: 1, text: 'x' }, { editable: true, editing: true, onEdit: () => {}, onSave, onCancel: () => {} });
    (el.querySelector('textarea.bubble-editor') as HTMLTextAreaElement).value = '   ';
    (el.querySelector('.bubble-save') as HTMLButtonElement).click();
    expect(onSave).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run --project client packages/client/tests/unit/pages/grade/UserBubble.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement**

```typescript
// packages/client/src/pages/grade/UserBubble.ts
import { renderLatex } from '@/lib/latex';

const PENCIL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
  stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9" />
  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>`;

export interface UserBubbleData { id: number; text: string }
export interface UserBubbleOpts {
  editable: boolean;
  editing: boolean;
  onEdit: (id: number) => void;
  onSave: (id: number, text: string) => void;
  onCancel: () => void;
}

/** A user turn: display (with optional Edit affordance) or inline editor. */
export function UserBubble(turn: UserBubbleData, opts: UserBubbleOpts): HTMLElement {
  const el = document.createElement('div');
  el.className = 'chat-bubble chat-bubble-user';

  if (opts.editing) {
    const ta = document.createElement('textarea');
    ta.className = 'bubble-editor';
    ta.value = turn.text;

    const actions = document.createElement('div');
    actions.className = 'bubble-edit-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'bubble-btn bubble-cancel'; cancel.textContent = 'Cancel';
    const save = document.createElement('button');
    save.type = 'button'; save.className = 'bubble-btn bubble-save'; save.textContent = 'Save';
    cancel.addEventListener('click', () => opts.onCancel());
    save.addEventListener('click', () => {
      const v = ta.value.trim();
      if (!v) return;
      opts.onSave(turn.id, v);
    });
    actions.append(cancel, save);
    el.append(ta, actions);
    queueMicrotask(() => ta.focus());
    return el;
  }

  const body = document.createElement('div');
  renderLatex(body, turn.text);
  el.appendChild(body);

  if (opts.editable) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'bubble-edit';
    edit.innerHTML = PENCIL + '<span>Edit</span>';
    edit.setAttribute('aria-label', 'Edit your message');
    edit.addEventListener('click', () => opts.onEdit(turn.id));
    el.appendChild(edit);
  }
  return el;
}
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run --project client packages/client/tests/unit/pages/grade/UserBubble.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/pages/grade/UserBubble.ts packages/client/tests/unit/pages/grade/UserBubble.test.ts
git commit -m "feat(grade): UserBubble with inline edit affordance/editor"
```

---

### Task 9: `GradePage.css` — port the mock styles

Port `docs/mocks/grade.css` into the real stylesheet. The mock's chat-bubble / reply / thinking styles already live in component CSS (`ChatBubble.css`, `ReplyRow.css`, `ThinkingBubble.css`, new `PhotoBubble.css`), so GradePage.css carries only page-shell + grade-specific styles: phase bar, qfold, grade badge/issues/reasoning, reading bubble, edit affordance/editor, advance button, grade buttons.

**Files:**
- Modify: `packages/client/src/pages/GradePage.css`

- [ ] **Step 1: Replace GradePage.css** with the grade-specific rules from the mock

Copy these blocks **verbatim from `docs/mocks/grade.css`** into `packages/client/src/pages/GradePage.css`, keeping the existing prod blocks that already match (qfold, grade-badge, issue-list, reasoning, grade-actions, grade-row/btn, suggested) and ADDING the new ones:
- `.grade-page` grid → `grid-template-rows: auto auto auto 1fr auto;` (topbar / question / phase bar / chat / actions)
- `.phase-bar`, `.phase-step`, `.phase-name`
- `.reading-label`
- `.bubble-edit`, `.bubble-editor`, `.bubble-edit-actions`, `.bubble-btn`, `.bubble-cancel`, `.bubble-save`
- `.chat-bubble-user` becomes `display:flex; flex-direction:column; gap:0.4rem;` (to host the edit affordance); ensure `.photo-bubble` overrides back to `flex-direction:row; flex-wrap:wrap`
- `.advance-btn`
- Keep `.grade-badge.grade-*` colors as in the mock (correct=green, partial=orange, incorrect=purple)

Remove any `.photo-capture*` / `.img-src*` styles from GradePage.css **only if** the photo-capture picker is no longer rendered by GradePage (Task 13 keeps the capture picker via `ImageSourcePicker`, whose styles live in `ImageSourcePicker.css`; the `.photo-capture` wrapper styles stay in GradePage.css). Net: keep `.photo-capture` + `.photo-capture-prompt`; PhotoBubble styles moved to `PhotoBubble.css` (delete the `.photo-bubble`/`.photo-thumb`/`.photo-notes-text` rules here to avoid duplication).

- [ ] **Step 2: Typecheck (CSS has no test; verify build resolves)**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/pages/GradePage.css
git commit -m "style(grade): port grade-chat styles from the approved mock"
```

---

### Task 10: `GradePage.ts` rewrite — shell, model, render(), typed boot

This task makes the **typed** grading flow work end-to-end (no photo). Photo phase is added in Task 13.

**Files:**
- Modify (replace): `packages/client/src/pages/GradePage.ts`
- Test: `packages/client/tests/integration/GradePage.test.ts` (create)

- [ ] **Step 1: Write the failing integration test (typed flow)**

```typescript
// packages/client/tests/integration/GradePage.test.ts
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { GradePage } from '@/pages/GradePage';

function setHash(h: string) { window.location.hash = h; }

function mockEndpoints() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/grade')) {
      return { ok: true, status: 200, json: async () => ({ reasoning: 'r', issues: [], recommendedGrade: 'correct' }) };
    }
    if (url.includes('/questions/') && !url.includes('/grade') && !url.includes('/attempts') && !url.includes('/transcribe')) {
      return { ok: true, status: 200, json: async () => ({ canonicalText: 'Q text', label: 'Griffiths · Ch 2 · P1', bookId: 'b1' }) };
    }
    if (url.includes('/books/')) return { ok: true, status: 200, json: async () => ({ title: 'Griffiths' }) };
    if (url.endsWith('/attempts')) return { ok: true, status: 201, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

beforeEach(() => { mockEndpoints(); });
afterEach(() => { vi.unstubAllGlobals(); setHash(''); });

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('GradePage (typed flow)', () => {
  test('boots into the grading phase with no phase bar', async () => {
    setHash('#/grade?questionId=q1&mode=type&from=learn');
    const page = GradePage();
    document.body.appendChild(page);
    await flush();
    expect(page.querySelector('.phase-bar')?.hasAttribute('hidden')).toBe(true);
    expect(page.querySelector('.grade-row')?.hasAttribute('hidden')).toBe(true);
    page.remove();
  });

  test('typing an answer grades it and reveals the grade-row', async () => {
    setHash('#/grade?questionId=q1&mode=type&from=learn');
    const page = GradePage();
    document.body.appendChild(page);
    await flush();
    const input = page.querySelector('.reply-input') as HTMLTextAreaElement;
    input.value = 'x = 4';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush(); await flush();
    expect(page.querySelector('.chat-bubble-user')?.textContent).toContain('x = 4');
    expect(page.querySelector('.chat-bubble-agent .grade-badge')?.textContent).toBe('correct');
    expect(page.querySelector('.grade-row')?.hasAttribute('hidden')).toBe(false);
    page.remove();
  });
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run --project client packages/client/tests/integration/GradePage.test.ts`
Expected: FAIL (current GradePage has no phase bar / different structure).

- [ ] **Step 3: Implement the rewrite (typed flow only; photo helpers stubbed in Task 13)**

```typescript
// packages/client/src/pages/GradePage.ts
import { html } from '@/lib/html';
import { renderLatex } from '@/lib/latex';
import { TopBar } from '@/components/TopBar';
import { ChatContainer } from '@/components/ChatContainer';
import { ChatBubble } from '@/components/ChatBubble';
import { ReplyRow } from '@/components/ReplyRow';
import { ThinkingBubble } from '@/components/ThinkingBubble';
import { recordCompleted } from '@/lib/session';
import { splitLabel } from '@/lib/problem-grouping';
import { Conversation } from './grade/conversation';
import type { Grade } from './grade/conversation';
import * as gradeApi from './grade/grade-api';
import { GraderBubble } from './grade/GraderBubble';
import { UserBubble } from './grade/UserBubble';
import { ReadingBubble } from './grade/ReadingBubble';
import { PhotoBubble } from '@/components/PhotoBubble';
import './GradePage.css';

type Phase = 'transcribe' | 'grade';

export function GradePage(): HTMLElement {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const questionId = params.get('questionId') ?? '';
  const mode = (params.get('mode') as 'photo' | 'type') ?? 'type';
  const from = params.get('from') === 'revisit' ? 'revisit' : 'learn';

  // ---- State ----
  const convo = new Conversation();
  let phase: Phase = 'grade';
  let sending = false;
  let editingId: number | null = null;
  let transient: HTMLElement | null = null;     // capture prompt / thinking bubble
  let photoFiles: File[] = [];                   // kept for /transcribe/retry
  let completedChapter: string | null = null;

  const chat = ChatContainer();

  // ---- Question fold ----
  const qEyebrow = document.createElement('span');
  qEyebrow.className = 'qfold-ctx';
  const qBody = document.createElement('div');
  qBody.className = 'qfold-body';
  const qfold = html`<details class="qfold">
    <summary class="qfold-summary">
      <span class="qfold-label">Question</span>
      ${qEyebrow}
      <span class="qfold-chev" aria-hidden="true">⌄</span>
    </summary>
    ${qBody}
  </details>`;

  // ---- Phase bar (photo flow only) ----
  const phaseStep = html`<span class="phase-step"></span>`;
  const phaseName = html`<span class="phase-name"></span>`;
  const phaseBar = html`<div class="phase-bar">${phaseStep}${phaseName}</div>`;
  phaseBar.hidden = true;

  // ---- Footer controls ----
  const reply = ReplyRow({
    placeholder: 'Clarify or add to your answer…',
    onSend(text) { void onSend(text); },
  });

  const advanceBtn = html`<button class="advance-btn" type="button">Looks good — grade it →</button>`;
  advanceBtn.hidden = true;
  advanceBtn.addEventListener('click', () => { void enterGradePhase(); });

  const gradeRow = html`<div class="grade-row">
    <button class="grade-btn gb-incorrect" data-grade="incorrect" type="button">Incorrect</button>
    <button class="grade-btn gb-partial" data-grade="partial" type="button">Partial</button>
    <button class="grade-btn gb-correct" data-grade="correct" type="button">Correct</button>
  </div>`;
  gradeRow.hidden = true;
  gradeRow.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-grade]') as HTMLElement | null;
    if (btn) void saveAttempt(btn.dataset.grade as Grade);
  });

  // ---- Skip + top bar ----
  const skipBtn = html`<button class="topbar-btn">Skip <span class="tb-sub">12h</span></button>`;
  skipBtn.addEventListener('click', () => {
    void gradeApi.skip(questionId).then(() => { window.location.hash = `#/${from}`; });
  });
  const topBar = TopBar({ onBack: () => { window.location.hash = `#/${from}`; }, right: skipBtn });

  const page = html`<div class="grade-page">
    ${topBar}
    ${qfold}
    ${phaseBar}
    ${chat.el}
    <footer class="grade-actions">
      ${reply.el}
      ${advanceBtn}
      ${gradeRow}
    </footer>
  </div>`;

  // ---- Render from state ----
  function buildTurn(turn: Conversation['turns'][number]): HTMLElement {
    if (turn.role === 'user' && turn.kind === 'photo') return PhotoBubble(photoFiles, { notes: turn.notes });
    if (turn.role === 'user' && turn.kind === 'text') {
      return UserBubble(
        { id: turn.id, text: turn.text },
        {
          editable: phase === 'grade' && !sending,
          editing: editingId === turn.id,
          onEdit: (id) => { editingId = id; render(); },
          onCancel: () => { editingId = null; render(); },
          onSave: (id, text) => {
            editingId = null;
            convo.editUserTurn(id, text);
            render();
            void doGrade();
          },
        },
      );
    }
    if (turn.kind === 'reading') return ReadingBubble(turn.text);
    return GraderBubble(turn.payload);
  }

  function render(): void {
    chat.clear();
    for (const turn of convo.turns) chat.el.appendChild(buildTurn(turn));
    if (transient) chat.el.appendChild(transient);

    phaseBar.hidden = mode !== 'photo';
    if (mode === 'photo') {
      phaseStep.textContent = phase === 'transcribe' ? 'Step 1 of 2' : 'Step 2 of 2';
      phaseName.textContent = phase === 'transcribe' ? 'Check the reading' : 'Grading';
    }

    if (phase === 'transcribe') {
      reply.setPlaceholder('Tell me what to fix…');
      advanceBtn.hidden = !convo.turns.some((t) => t.kind === 'reading');
      gradeRow.hidden = true;
    } else {
      reply.setPlaceholder('Clarify or add to your answer…');
      advanceBtn.hidden = true;
      gradeRow.hidden = convo.latestGrade === null;
      const suggested = convo.latestGrade?.recommendedGrade ?? null;
      gradeRow.querySelectorAll('.grade-btn').forEach((b) => {
        (b as HTMLElement).classList.toggle('suggested', (b as HTMLElement).dataset.grade === suggested);
      });
    }
    reply.setSending(sending);
  }

  // ---- Grading flow (Task 11 fills doGrade/onSend/saveAttempt) ----
  async function doGrade(): Promise<void> { /* Task 11 */ }
  async function onSend(_text: string): Promise<void> { /* Task 11 */ }
  async function saveAttempt(_rating: Grade): Promise<void> { /* Task 11 */ }
  async function enterGradePhase(): Promise<void> { /* Task 13 */ }

  // ---- Boot ----
  async function boot(): Promise<void> {
    try {
      const qRes = await fetch(`/api/questions/${questionId}`);
      if (!qRes.ok) throw new Error('question not found');
      const question = await qRes.json() as { canonicalText: string; label: string; bookId: string };
      completedChapter = splitLabel(question.label)?.chapter ?? null;
      renderLatex(qBody, question.canonicalText);
      try {
        const bRes = await fetch(`/api/books/${question.bookId}`);
        qEyebrow.textContent = bRes.ok ? `${(await bRes.json() as { title: string }).title} · ${question.label}` : question.label;
      } catch { qEyebrow.textContent = question.label; }

      if (mode === 'photo') { /* Task 13: startPhotoFlow() */ }
      else { phase = 'grade'; render(); chat.scrollToTop(); reply.focus(); }
    } catch {
      qEyebrow.textContent = 'Error';
      const err = ChatBubble('agent');
      err.textContent = 'Failed to load question. Go back and try again.';
      chat.append(err);
    }
  }

  // expose for ThinkingBubble usage in later tasks
  void ThinkingBubble;
  void recordCompleted;
  void completedChapter;

  void boot();
  return page;
}
```

> Note: the stubbed `doGrade`/`onSend`/`saveAttempt`/`enterGradePhase` make this task compile; Tasks 11 and 13 replace them with real bodies. The integration test's second assertion (typing → grade) will pass only after Task 11. Split the test: keep only the **first** test ("boots into grading phase") active now; mark the second `test.skip` until Task 11, then un-skip.

- [ ] **Step 4: Run the first test green**

Run: `npx vitest run --project client packages/client/tests/integration/GradePage.test.ts -t "boots into the grading phase"`
Expected: PASS. Then `npm run typecheck` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/pages/GradePage.ts packages/client/tests/integration/GradePage.test.ts
git commit -m "feat(grade): GradePage shell + render-from-state + typed boot"
```

---

### Task 11: Grading flow — `onSend`, `doGrade`, `saveAttempt`

**Files:**
- Modify: `packages/client/src/pages/GradePage.ts`
- Modify: `packages/client/tests/integration/GradePage.test.ts` (un-skip the second test)

- [ ] **Step 1: Un-skip the "typing an answer grades it" test** (change `test.skip` back to `test`).

- [ ] **Step 2: Run it red**

Run: `npx vitest run --project client packages/client/tests/integration/GradePage.test.ts`
Expected: FAIL — grade-row stays hidden (doGrade is a stub).

- [ ] **Step 3: Replace the three stubs** in GradePage.ts

```typescript
  async function doGrade(): Promise<void> {
    sending = true;
    const thinking = ThinkingBubble('Grading…');
    transient = thinking;
    render();
    chat.scrollToBottom();
    try {
      const payload = await gradeApi.grade(questionId, convo.toGradePayload());
      transient = null;
      convo.addGrade(payload);
      sending = false;
      render();
      const last = chat.el.querySelector('.chat-bubble-agent:last-of-type') as HTMLElement | null;
      if (last) chat.scrollToNode(last);
    } catch {
      transient = null;
      sending = false;
      render();
      const err = ChatBubble('agent');
      err.textContent = 'Grading failed. Send your message again to retry.';
      chat.el.appendChild(err);
    }
  }

  async function onSend(text: string): Promise<void> {
    if (phase === 'transcribe') {
      convo.addUser(text);          // a correction
      render();
      chat.scrollToBottom();
      await reReadPhoto(text);
    } else {
      convo.addUser(text);          // an answer / clarification
      render();
      chat.scrollToBottom();
      await doGrade();
    }
  }

  async function saveAttempt(rating: Grade): Promise<void> {
    const latest = convo.latestGrade;
    try {
      await gradeApi.saveAttempt(questionId, {
        answer: convo.firstAnswer,
        recommendedGrade: latest?.recommendedGrade ?? rating,
        rating,
        issues: latest?.issues ?? [],
      });
      recordCompleted(from, completedChapter);
      window.location.hash = `#/${from}`;
    } catch {
      const err = ChatBubble('agent');
      err.textContent = 'Failed to save. Try again.';
      chat.el.appendChild(err);
    }
  }
```

Add a stub for the transcription re-read so this compiles (real body in Task 13):

```typescript
  async function reReadPhoto(_correction: string): Promise<void> { /* Task 13 */ }
```

Remove the now-unnecessary `void ThinkingBubble; void recordCompleted; void completedChapter;` lines.

- [ ] **Step 4: Run it green**

Run: `npx vitest run --project client packages/client/tests/integration/GradePage.test.ts`
Expected: PASS (both tests). Then `npm run typecheck` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/pages/GradePage.ts packages/client/tests/integration/GradePage.test.ts
git commit -m "feat(grade): grading flow — send, grade, save attempt"
```

---

### Task 12: Edit & revert (integration test)

The wiring already exists in `buildTurn` (Task 10) and `editUserTurn`/`doGrade` (Tasks 1/11). This task adds a regression test proving the end-to-end behavior.

**Files:**
- Modify: `packages/client/tests/integration/GradePage.test.ts`

- [ ] **Step 1: Add the test**

```typescript
  test('editing an earlier answer truncates downstream turns and regrades', async () => {
    setHash('#/grade?questionId=q1&mode=type&from=learn');
    const page = GradePage();
    document.body.appendChild(page);
    await flush();

    // First answer → grade
    const input = page.querySelector('.reply-input') as HTMLTextAreaElement;
    input.value = 'first answer';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush(); await flush();
    // Clarify → second grade
    input.value = 'a clarification';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush(); await flush();
    expect(page.querySelectorAll('.chat-bubble-user')).toHaveLength(2);

    // Edit the FIRST user bubble
    const firstEdit = page.querySelector('.chat-bubble-user .bubble-edit') as HTMLButtonElement;
    firstEdit.click();
    await flush();
    const editor = page.querySelector('textarea.bubble-editor') as HTMLTextAreaElement;
    editor.value = 'edited first answer';
    (page.querySelector('.bubble-save') as HTMLButtonElement).click();
    await flush();

    // Downstream gone (one user turn), regrade in flight then lands
    expect(page.querySelectorAll('.chat-bubble-user')).toHaveLength(1);
    expect(page.querySelector('.chat-bubble-user')?.textContent).toContain('edited first answer');
    await flush(); await flush();
    expect(page.querySelector('.chat-bubble-agent .grade-badge')).not.toBeNull();
    page.remove();
  });
```

- [ ] **Step 2: Run it**

Run: `npx vitest run --project client packages/client/tests/integration/GradePage.test.ts -t "editing an earlier answer"`
Expected: PASS (no code change needed — proves Tasks 1/10/11 compose correctly). If it fails, fix the wiring in `buildTurn`/`editUserTurn`.

- [ ] **Step 3: Commit**

```bash
git add packages/client/tests/integration/GradePage.test.ts
git commit -m "test(grade): edit-and-revert truncates downstream turns and regrades"
```

---

### Task 13: Photo flow — transcription chat + handoff to grading

**Files:**
- Modify: `packages/client/src/pages/GradePage.ts`
- Modify: `packages/client/tests/integration/GradePage.test.ts`

- [ ] **Step 1: Add the photo-flow integration test**

```typescript
  test('photo flow: read → correct → re-read → confirm → grade', async () => {
    // transcribe + retry + grade mocks
    vi.unstubAllGlobals();
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/transcribe')) { reads++; return { ok: true, status: 200, json: async () => ({ transcription: 'reading 1' }) }; }
      if (url.endsWith('/transcribe/retry')) { reads++; return { ok: true, status: 200, json: async () => ({ transcription: 'reading 2' }) }; }
      if (url.endsWith('/grade')) return { ok: true, status: 200, json: async () => ({ reasoning: 'r', issues: [], recommendedGrade: 'correct' }) };
      if (url.includes('/books/')) return { ok: true, status: 200, json: async () => ({ title: 'Griffiths' }) };
      if (url.includes('/questions/')) return { ok: true, status: 200, json: async () => ({ canonicalText: 'Q', label: 'Griffiths · Ch 2 · P1', bookId: 'b1' }) };
      return { ok: true, status: 200, json: async () => ({}) };
    }));
    // stash a photo so startPhotoFlow uses it (see unstashPhotos)
    const { stashPhotos } = await import('@/lib/photo-transfer');
    stashPhotos([new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })], '');

    setHash('#/grade?questionId=q1&mode=photo&from=learn');
    const page = GradePage();
    document.body.appendChild(page);
    await flush(); await flush();

    // Step 1 transcription: phase bar + first reading
    expect(page.querySelector('.phase-bar')?.hasAttribute('hidden')).toBe(false);
    expect(page.querySelector('.reading-bubble')?.textContent).toContain('reading 1');
    expect(page.querySelector('.advance-btn')?.hasAttribute('hidden')).toBe(false);

    // Correct it → re-read
    const input = page.querySelector('.reply-input') as HTMLTextAreaElement;
    input.value = 'that 7 is a 1';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush(); await flush();
    expect(page.querySelectorAll('.reading-bubble')).toHaveLength(2);

    // Confirm → grading phase, seeded answer, grade lands
    (page.querySelector('.advance-btn') as HTMLButtonElement).click();
    await flush(); await flush();
    expect(page.querySelector('.reading-bubble')).toBeNull();      // transcription chat cleared
    expect(page.querySelectorAll('.chat-bubble-user')).toHaveLength(1);
    expect(page.querySelector('.chat-bubble-agent .grade-badge')?.textContent).toBe('correct');
    page.remove();
  });
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run --project client packages/client/tests/integration/GradePage.test.ts -t "photo flow"`
Expected: FAIL (photo helpers are stubs).

- [ ] **Step 3: Implement the photo helpers.** Add the import and replace the stubbed `enterGradePhase`/`reReadPhoto` and the boot's photo branch.

Add to the imports:

```typescript
import { unstashPhotos } from '@/lib/photo-transfer';
import { ImageSourcePicker } from '@/components/ImageSourcePicker';
```

Replace the boot photo branch `if (mode === 'photo') { /* Task 13 */ }` with `if (mode === 'photo') { startPhotoFlow(); }`.

Add these functions (and remove the `reReadPhoto`/`enterGradePhase` stubs):

```typescript
  function startPhotoFlow(): void {
    phase = 'transcribe';
    const transfer = unstashPhotos();
    if (transfer && transfer.files.length > 0) {
      photoFiles = transfer.files;
      convo.addPhoto(transfer.notes);
      render();
      chat.scrollToBottom();
      void readPhoto(transfer.notes);
    } else {
      showPhotoCapture();
    }
  }

  function showPhotoCapture(): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'photo-capture';
    const prompt = document.createElement('div');
    prompt.className = 'photo-capture-prompt';
    prompt.textContent = 'Add a photo of your solution';
    const picker = ImageSourcePicker({
      onFiles(files) {
        photoFiles = files;
        transient = null;
        convo.addPhoto('');
        render();
        chat.scrollToBottom();
        void readPhoto('');
      },
    });
    wrapper.append(prompt, picker);
    transient = wrapper;
    render();
  }

  async function readPhoto(notes: string): Promise<void> {
    sending = true;
    transient = ThinkingBubble('Reading…');
    render();
    chat.scrollToBottom();
    try {
      const text = await gradeApi.transcribe(questionId, photoFiles, notes);
      transient = null;
      convo.addReading(text);
      sending = false;
      render();
      const last = chat.el.querySelector('.reading-bubble:last-of-type') as HTMLElement | null;
      if (last) chat.scrollToNode(last);
    } catch {
      transient = null;
      sending = false;
      render();
      const err = ChatBubble('agent');
      err.textContent = 'Transcription failed. Try typing your answer instead.';
      chat.el.appendChild(err);
    }
  }

  async function reReadPhoto(correction: string): Promise<void> {
    const current = lastReading();
    sending = true;
    transient = ThinkingBubble('Re-reading…');
    render();
    chat.scrollToBottom();
    try {
      const text = await gradeApi.retranscribe(questionId, photoFiles, current, correction);
      transient = null;
      convo.addReading(text);
      sending = false;
      render();
      const last = chat.el.querySelector('.reading-bubble:last-of-type') as HTMLElement | null;
      if (last) chat.scrollToNode(last);
    } catch {
      transient = null;
      sending = false;
      render();
      const err = ChatBubble('agent');
      err.textContent = 'Re-reading failed. Try again.';
      chat.el.appendChild(err);
    }
  }

  function lastReading(): string {
    for (let i = convo.turns.length - 1; i >= 0; i--) {
      const t = convo.turns[i];
      if (t.kind === 'reading') return t.text;
    }
    return '';
  }

  async function enterGradePhase(): Promise<void> {
    const reading = lastReading();
    phase = 'grade';
    convo.clear();
    editingId = null;
    convo.addUser(reading);     // seed the answer (now inline-editable)
    render();
    chat.scrollToTop();
    await doGrade();
  }
```

- [ ] **Step 4: Run green + full suite**

Run: `npx vitest run --project client packages/client/tests/integration/GradePage.test.ts`
Expected: PASS (all tests). Then `npm test` → all pass; `npm run typecheck` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/pages/GradePage.ts packages/client/tests/integration/GradePage.test.ts
git commit -m "feat(grade): two-step photo flow — conversational transcription then grading"
```

---

### Task 14: Cleanup + manual QA

**Files:**
- Modify: `packages/client/src/pages/GradePage.ts` (delete dead code), any leftover unused imports.

- [ ] **Step 1: Remove dead code** — confirm the old `renderGraderBubble`, `handleUserMessage`, `startPhotoFlow` (old single-conversation versions), the local `Turn`/`GradingIssue` interfaces, and the old `ImageSourcePicker` photo-capture block are all gone (replaced). Remove any unused imports (`ChatBubble` is still used for error bubbles — keep it).

Run: `npm run typecheck` → exit 0 (catches unused-import/type errors). Run: `npx eslint packages/client/src/pages/GradePage.ts` if the repo lints (check `package.json` for a lint script; skip if none).

- [ ] **Step 2: Full green**

Run: `npm test`
Expected: all server + client tests pass.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Manual QA against the mock** (start the app: `npm run dev`, open the client). Walk both flows and confirm they match `docs/mocks/grade.html`:
  - Typed: `#/grade?questionId=<real>&mode=type&from=learn` — opens at top, type an answer → grades → grade-row with Suggested; edit an earlier answer → downstream vanishes → regrades; while grading the textarea stays editable and send greys out.
  - Photo: `mode=photo` — capture/stashed photo → "Reading…" → reading bubble (Step 1 of 2); correct it → "Re-reading…" → updated reading; "Looks good — grade it →" → Step 2 of 2, seeded answer, grader reply; save advances.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/pages/GradePage.ts
git commit -m "chore(grade): remove dead code from the old GradePage implementation"
```

---

## Self-Review

**Spec/mock coverage:**
- Edit & revert (3g) → Tasks 1 (`editUserTurn`), 8 (`UserBubble`), 10–12. ✅
- Scroll rules → Task 3 (`scrollToTop`/`scrollToNode`), used in 10/11/13. ✅
- Compose-while-busy → Task 4 (`setSending`), enforced in `render()`. ✅
- Conversational transcription + re-read → Task 13 (`readPhoto`/`reReadPhoto` via `/transcribe/retry`). ✅
- Two sequential chats + phase bar → Tasks 10 (`render` phase bar), 13 (`enterGradePhase` clears + seeds). ✅
- Save attempt / skip → Task 11 (`saveAttempt`), 10 (skip). ✅
- Grid removal → already done (commit `820d21e`), nothing to do here. ✅

**Placeholder scan:** the only stubs are explicit, named, and replaced within the same plan (Task 10 stubs → real in 11/13). No "TBD"/"handle edge cases"/"add validation" left. ✅

**Type consistency:** `GradePayload` (`reasoning`/`issues`/`recommendedGrade`) is used identically across `conversation.ts`, `grade-api.ts`, `GraderBubble.ts`, and `GradePage.ts`. `ApiTurn` from `conversation.ts` is the single grade-wire type. `Turn` kinds (`text`/`photo`/`reading`/`grade`) match between the model and `buildTurn`. ✅

**Known risk:** the integration test relies on `flush()` (a `setTimeout(0)`) to drain the awaited fetch chain; if a flow adds another `await` hop, add another `await flush()`. Tests use `vi.stubGlobal('fetch', …)` so no network. If `recordCompleted`/`splitLabel`/`unstashPhotos`/`stashPhotos` signatures differ from what's shown, adjust the call sites (verify against their source before Task 10/13).
