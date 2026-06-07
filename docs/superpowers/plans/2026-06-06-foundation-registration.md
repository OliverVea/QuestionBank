# Foundation: Registration (Manage tab, Step 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the functional **Manage** tab — a three-tab app shell plus inline CRUD for Books, Chapters, and Questions backed by a JSON-file storage layer, with questions showing **raw LaTeX source** (no rendering yet).

**Architecture:** Express REST API over a flat, one-file-per-entity JSON store loaded into an in-memory working set with write-through-on-mutation, all hidden behind a typed `Repository<T>` interface. A framework-free Vita + vanilla-TS client renders a master/detail Manage UI (Books → Book → Chapter → Questions) that hits the REST endpoints. Learn and Practice tabs are present but stubbed.

**Tech Stack:** TypeScript (strict ESM), Express 4, Node ≥ 20 (`crypto.randomUUID` — no `uuid` dependency), Vite 5 (vanilla TS, no UI framework), Vitest 2 for tests.

**Scope notes (read before starting):**
- This plan covers **only Step 1 (Registration)** of the foundation sub-project. LLM bulk ingestion (Step 2) and KaTeX rendering / P0 polish (Step 3) are **out of scope** and get their own plans later.
- **Backups are deliberately deferred.** The architecture and foundation specs put `BackupStore` + the retention timer in Step 1; this plan intentionally departs from that and ships CRUD only. The storage layer is built so a `BackupStore` can be added later without rework. A follow-up plan will add it.
- The `relevance` and `nextReviewDate` Question fields exist in the schema but are left unset here (they serve later sub-projects).
- Source-of-truth specs: `docs/superpowers/specs/2026-06-06-foundation-registration-design.md` and `docs/superpowers/specs/2026-06-06-question-bank-architecture.md`.

**Repo conventions (from `AGENTS.md`, must follow):**
- TypeScript everywhere, strict mode on (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Never loosen tsconfig to silence errors — fix the code.
- ESM only (`"type": "module"`); `import`/`export`, never `require`.
- Framework-free client. No React/Vue/Svelte, no CSS framework, no state-management lib.
- Storage is JSON files; keep the layer thin and swappable. No ORM/DB driver.
- Co-locate tests as `*.test.ts` next to the code they cover.
- Run everything from the repo root. `npm run typecheck` and `npm test` before declaring work done.
- Each task ends with something **observable in the browser** where possible.

**Existing scaffold (already present — do not recreate):**
- Root: `package.json` (npm workspaces, scripts: `dev`, `build`, `test` = `vitest run`, `typecheck` = `tsc -b`), `tsconfig.base.json`, `tsconfig.json` (project references).
- `packages/server`: `src/index.ts` (Express app with `GET /api/health`), `tsconfig.json` (NodeNext), `package.json` (`dev` = `tsx watch src/index.ts`).
- `packages/client`: `src/main.ts`, `index.html`, `vite.config.ts` (proxies `/api` → `http://localhost:3001`, port 5173), `tsconfig.json` (DOM libs).
- `data/` exists (gitignored: `data/*.json`, `data/.backups/`, `data/images/`).

**Conventions this plan establishes (use consistently in every task):**
- Server source lives under `packages/server/src/`, organized by responsibility:
  - `domain/` — entity types + ID/timestamp helpers (pure, no I/O).
  - `storage/` — the JSON store, working set, and `Repository<T>`.
  - `services/` — cross-entity logic (cascade deletes, tree assembly).
  - `routes/` — Express routers, one file per resource.
- Client source lives under `packages/client/src/`, organized by responsibility:
  - `api/` — typed fetch wrappers.
  - `tabs/` — one module per tab (`manage`, `learn`, `practice`).
  - `manage/` — the master/detail views for the Manage tab.
- **Shared types are duplicated, not shared via a package.** The client redeclares the DTO shapes it needs in `packages/client/src/api/`. (A shared package is a YAGNI for this step; revisit if drift becomes painful.)
- IDs are `crypto.randomUUID()`. Timestamps are `new Date().toISOString()`.
- All entity JSON files live at `data/<plural>.json` (`data/books.json`, `data/chapters.json`, `data/questions.json`).

---

## File Structure

**Server (`packages/server/src/`):**
- `domain/ids.ts` — `newId()`, `nowIso()` helpers.
- `domain/types.ts` — `Book`, `Chapter`, `Question`, `QuestionSource` interfaces.
- `storage/json-collection.ts` — `JsonCollection<T>`: loads one JSON file into memory, writes through on mutation, implements `Repository<T>`.
- `storage/repository.ts` — the `Repository<T>` interface.
- `storage/store.ts` — `Store`: wires the three collections together, exposes them, owns the data directory.
- `services/cascade.ts` — cascade-delete helpers (deleting a book removes its chapters + questions; deleting a chapter removes its questions).
- `services/tree.ts` — assembles a book + nested chapters + questions for the `/tree` endpoint.
- `routes/books.ts`, `routes/chapters.ts`, `routes/questions.ts` — Express routers.
- `index.ts` (modify) — construct the `Store`, mount the routers.
- Tests co-located: `domain/types.test.ts` is unnecessary (pure interfaces); test the collection, services, and routes.

**Client (`packages/client/src/`):**
- `main.ts` (modify) — bootstrap the tab shell.
- `tabs/shell.ts` — renders the three-tab navigation and switches active panel.
- `tabs/learn.ts`, `tabs/practice.ts` — stub panels.
- `tabs/manage.ts` — entry point for the Manage tab, owns the master/detail navigation state.
- `api/types.ts` — client-side DTO shapes (duplicated from server domain).
- `api/client.ts` — typed fetch wrappers for all endpoints.
- `manage/books-pane.ts`, `manage/chapters-pane.ts`, `manage/questions-pane.ts` — the three drill-down panes with inline add/edit.
- `styles.css` (create) — minimal responsive layout (tabs, two-pane/drill-down).
- `index.html` (modify) — link the stylesheet, set up the app root.

---

## Task 0: Add dev tooling the plan relies on

**Files:**
- Modify: `packages/server/package.json`
- Modify: `packages/server/src/index.ts` (only if needed to confirm supertest wiring later)

We test routes with `supertest` against the Express app. The app must be exported (not only `listen`ed) so tests can mount it without binding a port.

- [ ] **Step 1: Install supertest as a server dev dependency**

Run from repo root:
```bash
npm install --workspace @qb/server --save-dev supertest @types/supertest
```
Expected: `supertest` and `@types/supertest` appear under `devDependencies` in `packages/server/package.json`.

- [ ] **Step 2: Verify install and typecheck still pass**

Run:
```bash
npm run typecheck
```
Expected: PASS (no errors). The new deps are not yet imported, so this just confirms nothing broke.

- [ ] **Step 3: Commit**

```bash
git add packages/server/package.json package-lock.json
git commit -m "chore: add supertest for route testing"
```

---

## Task 1: Domain types and ID/timestamp helpers

**Files:**
- Create: `packages/server/src/domain/ids.ts`
- Create: `packages/server/src/domain/types.ts`
- Test: `packages/server/src/domain/ids.test.ts`

- [ ] **Step 1: Write the failing test for the ID/timestamp helpers**

Create `packages/server/src/domain/ids.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { newId, nowIso } from './ids.js';

describe('ids', () => {
  it('newId returns a unique uuid each call', () => {
    const a = newId();
    const b = newId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a).not.toEqual(b);
  });

  it('nowIso returns an ISO-8601 timestamp', () => {
    const ts = nowIso();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(new Date(ts).toISOString()).toEqual(ts);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run packages/server/src/domain/ids.test.ts
```
Expected: FAIL — `Failed to resolve import "./ids.js"` (module does not exist yet).

- [ ] **Step 3: Implement the helpers**

Create `packages/server/src/domain/ids.ts`:
```ts
import { randomUUID } from 'node:crypto';

/** A fresh UUID for entity ids. */
export function newId(): string {
  return randomUUID();
}

/** Current time as an ISO-8601 string, for `createdAt` fields. */
export function nowIso(): string {
  return new Date().toISOString();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run packages/server/src/domain/ids.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Create the entity type definitions**

Create `packages/server/src/domain/types.ts`. These mirror the architecture doc's data model. `relevance` and `nextReviewDate` are present but optional and unset by this sub-project.
```ts
/** Raw backing for a question — the original image or text it came from. */
export interface QuestionSource {
  kind: 'image' | 'text';
  /** Path under data/images to the original page photo, if kind === 'image'. */
  imagePath?: string;
  /** Plaintext input, if kind === 'text'. */
  rawText?: string;
}

export interface Book {
  id: string;
  title: string;
  author?: string;
  /** Core feature, optional per-book. */
  learningGoal?: string;
  createdAt: string;
}

export interface Chapter {
  id: string;
  bookId: string;
  title: string;
  /** Topics covered; also feeds critique later. */
  description?: string;
  /** Stable display ordering within a book. */
  order: number;
  createdAt: string;
}

export type Relevance = 'essential' | 'relevant' | 'can-skip' | 'should-skip';

export interface Question {
  id: string;
  chapterId: string;
  /** Book's own numbering, e.g. "2.4". */
  label?: string;
  /** LaTeX/markdown — source of truth. */
  canonicalText: string;
  source: QuestionSource;
  /** SRS field — unset by the foundation sub-project. */
  relevance?: Relevance;
  /** SRS live state — unset by the foundation sub-project. */
  nextReviewDate?: string;
  createdAt: string;
}
```

- [ ] **Step 6: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: PASS. (Note `exactOptionalPropertyTypes` is on — optional fields must be genuinely omitted, never assigned `undefined`. Keep this in mind for all later tasks.)

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/domain/
git commit -m "feat: add domain types and id/timestamp helpers"
```

---

## Task 2: Repository interface and JSON-backed collection

**Files:**
- Create: `packages/server/src/storage/repository.ts`
- Create: `packages/server/src/storage/json-collection.ts`
- Test: `packages/server/src/storage/json-collection.test.ts`

The collection loads one JSON file into an in-memory array on construction, serves reads from memory, and writes the whole array back to disk on every mutation (write-through). This is the thin, swappable storage primitive.

- [ ] **Step 1: Define the Repository interface**

Create `packages/server/src/storage/repository.ts`:
```ts
/** A typed entity store. Concrete implementations hide their backing (JSON now, SQL later). */
export interface Repository<T extends { id: string }> {
  getAll(): T[];
  getById(id: string): T | undefined;
  /** Persist a fully-formed entity (id already assigned by the caller). */
  create(entity: T): T;
  /** Shallow-merge `patch` into the stored entity; throws if id is unknown. */
  update(id: string, patch: Partial<Omit<T, 'id'>>): T;
  /** Remove the entity; no-op if id is unknown. */
  delete(id: string): void;
}
```

- [ ] **Step 2: Write the failing test for JsonCollection**

Create `packages/server/src/storage/json-collection.test.ts`. The test uses a real temp directory so write-through and reload are exercised end-to-end.
```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonCollection } from './json-collection.js';

interface Widget {
  id: string;
  name: string;
  size?: number;
}

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-coll-'));
  file = join(dir, 'widgets.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('JsonCollection', () => {
  it('starts empty when the file does not exist', async () => {
    const coll = await JsonCollection.open<Widget>(file);
    expect(coll.getAll()).toEqual([]);
  });

  it('creates, reads, updates and deletes, writing through to disk', async () => {
    const coll = await JsonCollection.open<Widget>(file);

    const created = coll.create({ id: 'w1', name: 'alpha' });
    expect(created).toEqual({ id: 'w1', name: 'alpha' });
    expect(coll.getById('w1')).toEqual({ id: 'w1', name: 'alpha' });

    const updated = coll.update('w1', { name: 'beta', size: 3 });
    expect(updated).toEqual({ id: 'w1', name: 'beta', size: 3 });

    coll.delete('w1');
    expect(coll.getById('w1')).toBeUndefined();
    expect(coll.getAll()).toEqual([]);
  });

  it('persists across reopen (write-through + reload)', async () => {
    const coll = await JsonCollection.open<Widget>(file);
    coll.create({ id: 'w1', name: 'alpha' });
    coll.create({ id: 'w2', name: 'gamma' });

    const reopened = await JsonCollection.open<Widget>(file);
    expect(reopened.getAll()).toHaveLength(2);
    expect(reopened.getById('w2')).toEqual({ id: 'w2', name: 'gamma' });

    // The on-disk file is valid JSON.
    const raw = await readFile(file, 'utf8');
    expect(JSON.parse(raw)).toHaveLength(2);
  });

  it('update throws on unknown id', async () => {
    const coll = await JsonCollection.open<Widget>(file);
    expect(() => coll.update('nope', { name: 'x' })).toThrow(/nope/);
  });

  it('getAll returns copies, not internal references', async () => {
    const coll = await JsonCollection.open<Widget>(file);
    coll.create({ id: 'w1', name: 'alpha' });
    const all = coll.getAll();
    all[0]!.name = 'mutated';
    expect(coll.getById('w1')!.name).toEqual('alpha');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:
```bash
npx vitest run packages/server/src/storage/json-collection.test.ts
```
Expected: FAIL — cannot resolve `./json-collection.js`.

- [ ] **Step 4: Implement JsonCollection**

Create `packages/server/src/storage/json-collection.ts`:
```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Repository } from './repository.js';

/**
 * One JSON file ↔ one in-memory array. Reads serve from memory; every mutation
 * rewrites the whole file (write-through), so a restart recovers the latest state.
 * Returned values are deep-cloned so callers cannot mutate the working set.
 */
export class JsonCollection<T extends { id: string }> implements Repository<T> {
  private items: T[];

  private constructor(
    private readonly filePath: string,
    initial: T[],
  ) {
    this.items = initial;
  }

  /** Load the file (missing file ⇒ empty collection) and return a ready collection. */
  static async open<T extends { id: string }>(filePath: string): Promise<JsonCollection<T>> {
    let initial: T[] = [];
    try {
      const raw = await readFile(filePath, 'utf8');
      initial = JSON.parse(raw) as T[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return new JsonCollection<T>(filePath, initial);
  }

  getAll(): T[] {
    return this.items.map(clone);
  }

  getById(id: string): T | undefined {
    const found = this.items.find((it) => it.id === id);
    return found ? clone(found) : undefined;
  }

  create(entity: T): T {
    this.items.push(clone(entity));
    void this.flush();
    return clone(entity);
  }

  update(id: string, patch: Partial<Omit<T, 'id'>>): T {
    const idx = this.items.findIndex((it) => it.id === id);
    if (idx === -1) throw new Error(`update: no entity with id ${id}`);
    const merged = { ...this.items[idx]!, ...patch } as T;
    this.items[idx] = merged;
    void this.flush();
    return clone(merged);
  }

  delete(id: string): void {
    const before = this.items.length;
    this.items = this.items.filter((it) => it.id !== id);
    if (this.items.length !== before) void this.flush();
  }

  private async flush(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.items, null, 2), 'utf8');
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
```

> Note: `flush()` is fire-and-forget (`void`) so the synchronous `Repository` contract holds. The architecture assumes a **single server instance with no concurrent writers**, so serialized writes from one event loop are safe; sequential mutations queue naturally because each `flush` is independent and writes the full array. If a future need arises for guaranteed write ordering, introduce a write queue — out of scope here.

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
npx vitest run packages/server/src/storage/json-collection.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/storage/
git commit -m "feat: add Repository interface and JSON-backed collection"
```

---

## Task 3: Store — wire the three collections together

**Files:**
- Create: `packages/server/src/storage/store.ts`
- Test: `packages/server/src/storage/store.test.ts`

- [ ] **Step 1: Write the failing test for Store**

Create `packages/server/src/storage/store.test.ts`:
```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from './store.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('Store', () => {
  it('opens three empty collections in a fresh data dir', async () => {
    const store = await Store.open(dir);
    expect(store.books.getAll()).toEqual([]);
    expect(store.chapters.getAll()).toEqual([]);
    expect(store.questions.getAll()).toEqual([]);
  });

  it('persists each entity type to its own file', async () => {
    const store = await Store.open(dir);
    store.books.create({ id: 'b1', title: 'Calc', createdAt: '2026-06-06T00:00:00.000Z' });

    const reopened = await Store.open(dir);
    expect(reopened.books.getById('b1')?.title).toEqual('Calc');
    expect(reopened.chapters.getAll()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run packages/server/src/storage/store.test.ts
```
Expected: FAIL — cannot resolve `./store.js`.

- [ ] **Step 3: Implement Store**

Create `packages/server/src/storage/store.ts`:
```ts
import { join } from 'node:path';
import type { Book, Chapter, Question } from '../domain/types.js';
import { JsonCollection } from './json-collection.js';
import type { Repository } from './repository.js';

/** Owns the data directory and the per-entity collections. */
export class Store {
  private constructor(
    readonly books: Repository<Book>,
    readonly chapters: Repository<Chapter>,
    readonly questions: Repository<Question>,
  ) {}

  static async open(dataDir: string): Promise<Store> {
    const [books, chapters, questions] = await Promise.all([
      JsonCollection.open<Book>(join(dataDir, 'books.json')),
      JsonCollection.open<Chapter>(join(dataDir, 'chapters.json')),
      JsonCollection.open<Question>(join(dataDir, 'questions.json')),
    ]);
    return new Store(books, chapters, questions);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run packages/server/src/storage/store.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck and full test run**

Run:
```bash
npm run typecheck && npm test
```
Expected: PASS — all tests so far green (ids, json-collection, store).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/storage/store.ts packages/server/src/storage/store.test.ts
git commit -m "feat: add Store wiring books/chapters/questions collections"
```

---

## Task 4: Books router + wire the Store into the server (first observable slice)

**Files:**
- Create: `packages/server/src/routes/books.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/src/routes/books.test.ts`

This is the first vertical slice that touches the running server. We mount a books router and exercise it over HTTP with supertest. To test without binding a port, `index.ts` is refactored to export a `createApp(store)` factory; `listen` stays at the bottom guarded for the real entry point.

- [ ] **Step 1: Write the failing test for the books router**

Create `packages/server/src/routes/books.test.ts`:
```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { Store } from '../storage/store.js';

let dir: string;
let app: Awaited<ReturnType<typeof createApp>>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-books-'));
  const store = await Store.open(dir);
  app = createApp(store);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('books routes', () => {
  it('POST creates a book and GET lists it', async () => {
    const post = await request(app).post('/api/books').send({ title: 'Calculus' });
    expect(post.status).toEqual(201);
    expect(post.body).toMatchObject({ title: 'Calculus' });
    expect(post.body.id).toBeTruthy();
    expect(post.body.createdAt).toBeTruthy();

    const list = await request(app).get('/api/books');
    expect(list.status).toEqual(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].title).toEqual('Calculus');
  });

  it('POST rejects a missing title with 400', async () => {
    const res = await request(app).post('/api/books').send({ author: 'nobody' });
    expect(res.status).toEqual(400);
  });

  it('GET :id returns one book, 404 when unknown', async () => {
    const created = (await request(app).post('/api/books').send({ title: 'Physics' })).body;
    const ok = await request(app).get(`/api/books/${created.id}`);
    expect(ok.status).toEqual(200);
    expect(ok.body.title).toEqual('Physics');

    const missing = await request(app).get('/api/books/does-not-exist');
    expect(missing.status).toEqual(404);
  });

  it('PATCH updates fields', async () => {
    const created = (await request(app).post('/api/books').send({ title: 'Physics' })).body;
    const patched = await request(app)
      .patch(`/api/books/${created.id}`)
      .send({ author: 'Feynman', learningGoal: 'intuition' });
    expect(patched.status).toEqual(200);
    expect(patched.body).toMatchObject({ author: 'Feynman', learningGoal: 'intuition' });
  });

  it('DELETE removes a book', async () => {
    const created = (await request(app).post('/api/books').send({ title: 'Physics' })).body;
    const del = await request(app).delete(`/api/books/${created.id}`);
    expect(del.status).toEqual(204);
    const list = await request(app).get('/api/books');
    expect(list.body).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run packages/server/src/routes/books.test.ts
```
Expected: FAIL — `createApp` is not exported from `../index.js` and `./books.js` does not exist.

- [ ] **Step 3: Implement the books router**

Create `packages/server/src/routes/books.ts`:
```ts
import { Router } from 'express';
import { newId, nowIso } from '../domain/ids.js';
import type { Book } from '../domain/types.js';
import type { Store } from '../storage/store.js';

export function booksRouter(store: Store): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(store.books.getAll());
  });

  router.post('/', (req, res) => {
    const { title, author, learningGoal } = req.body ?? {};
    if (typeof title !== 'string' || title.trim() === '') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const book: Book = {
      id: newId(),
      title: title.trim(),
      createdAt: nowIso(),
      ...(typeof author === 'string' && author.trim() !== '' ? { author: author.trim() } : {}),
      ...(typeof learningGoal === 'string' && learningGoal.trim() !== ''
        ? { learningGoal: learningGoal.trim() }
        : {}),
    };
    res.status(201).json(store.books.create(book));
  });

  router.get('/:id', (req, res) => {
    const book = store.books.getById(req.params.id);
    if (!book) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(book);
  });

  router.patch('/:id', (req, res) => {
    if (!store.books.getById(req.params.id)) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const patch: Partial<Omit<Book, 'id'>> = {};
    const { title, author, learningGoal } = req.body ?? {};
    if (typeof title === 'string') patch.title = title.trim();
    if (typeof author === 'string') patch.author = author.trim();
    if (typeof learningGoal === 'string') patch.learningGoal = learningGoal.trim();
    res.json(store.books.update(req.params.id, patch));
  });

  router.delete('/:id', (req, res) => {
    store.books.delete(req.params.id);
    res.status(204).end();
  });

  return router;
}
```

> Note on `exactOptionalPropertyTypes`: optional fields are added via conditional spread (so the key is omitted, never set to `undefined`). PATCH currently assigns trimmed strings only when the key is a string; empty-string handling for clearing a field is a later-iteration concern, not needed now.

- [ ] **Step 4: Refactor index.ts to a `createApp` factory and mount the router**

Replace the entire contents of `packages/server/src/index.ts` with:
```ts
import express, { type Express } from 'express';
import { join } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { booksRouter } from './routes/books.js';
import { Store } from './storage/store.js';

const PORT = Number(process.env.PORT ?? 3001);
const DATA_DIR = process.env.QB_DATA_DIR ?? join(process.cwd(), 'data');

/** Build the Express app over a given store. Exported so tests can mount it without a port. */
export function createApp(store: Store): Express {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/books', booksRouter(store));

  return app;
}

async function main(): Promise<void> {
  const store = await Store.open(DATA_DIR);
  const app = createApp(store);
  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
  });
}

// Only start a real server when this module is the process entry point — not when
// a test imports createApp. fileURLToPath turns import.meta.url into a native path,
// so the comparison works identically on Windows and POSIX (no manual slash munging).
const entry = argv[1];
if (entry !== undefined && fileURLToPath(import.meta.url) === entry) {
  void main();
}
```

> The entry-point guard prevents `listen` from running when the module is imported (e.g. by supertest tests), so tests never bind port 3001. Using `fileURLToPath(import.meta.url)` and comparing to `process.argv[1]` is the portable idiom — both sides are native filesystem paths. If a runner ever invokes the file through a symlink or loader shim and the comparison fails to match, fall back to an explicit `QB_NO_LISTEN` env guard; but this form is correct under `tsx`, `node dist/index.js`, and Vitest.

- [ ] **Step 5: Run the books test to verify it passes**

Run:
```bash
npx vitest run packages/server/src/routes/books.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 6: Manually verify in a running server**

Run the dev server:
```bash
npm run dev:server
```
In a second terminal:
```bash
curl -s http://localhost:3001/api/books
curl -s -X POST http://localhost:3001/api/books -H "content-type: application/json" -d '{"title":"Calculus"}'
curl -s http://localhost:3001/api/books
```
Expected: first call `[]`; POST returns the created book with an `id` and `createdAt`; final call lists it. Confirm `data/books.json` now exists on disk. Stop the server (Ctrl-C).

- [ ] **Step 7: Typecheck and commit**

Run:
```bash
npm run typecheck
```
Expected: PASS.
```bash
git add packages/server/src/index.ts packages/server/src/routes/books.ts packages/server/src/routes/books.test.ts
git commit -m "feat: add books CRUD endpoints and createApp factory"
```

---

## Task 5: Chapters router (nested under books) + cascade delete

**Files:**
- Create: `packages/server/src/services/cascade.ts`
- Create: `packages/server/src/routes/chapters.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/src/services/cascade.test.ts`
- Test: `packages/server/src/routes/chapters.test.ts`

- [ ] **Step 1: Write the failing test for cascade helpers**

Create `packages/server/src/services/cascade.test.ts`:
```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../storage/store.js';
import { deleteBookCascade, deleteChapterCascade } from './cascade.js';

let dir: string;
let store: Store;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-cascade-'));
  store = await Store.open(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function seed(): { bookId: string; chapterId: string } {
  const book = store.books.create({ id: 'b1', title: 'B', createdAt: 't' });
  const chapter = store.chapters.create({
    id: 'c1',
    bookId: book.id,
    title: 'C',
    order: 0,
    createdAt: 't',
  });
  store.questions.create({
    id: 'q1',
    chapterId: chapter.id,
    canonicalText: 'x',
    source: { kind: 'text', rawText: 'x' },
    createdAt: 't',
  });
  return { bookId: book.id, chapterId: chapter.id };
}

describe('cascade', () => {
  it('deleteChapterCascade removes the chapter and its questions', () => {
    const { chapterId } = seed();
    deleteChapterCascade(store, chapterId);
    expect(store.chapters.getById(chapterId)).toBeUndefined();
    expect(store.questions.getAll()).toEqual([]);
  });

  it('deleteBookCascade removes the book, its chapters and their questions', () => {
    const { bookId } = seed();
    deleteBookCascade(store, bookId);
    expect(store.books.getById(bookId)).toBeUndefined();
    expect(store.chapters.getAll()).toEqual([]);
    expect(store.questions.getAll()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run packages/server/src/services/cascade.test.ts
```
Expected: FAIL — cannot resolve `./cascade.js`.

- [ ] **Step 3: Implement the cascade helpers**

Create `packages/server/src/services/cascade.ts`:
```ts
import type { Store } from '../storage/store.js';

/** Delete a chapter and every question under it. */
export function deleteChapterCascade(store: Store, chapterId: string): void {
  for (const q of store.questions.getAll()) {
    if (q.chapterId === chapterId) store.questions.delete(q.id);
  }
  store.chapters.delete(chapterId);
}

/** Delete a book, every chapter under it, and every question under those chapters. */
export function deleteBookCascade(store: Store, bookId: string): void {
  for (const chapter of store.chapters.getAll()) {
    if (chapter.bookId === bookId) deleteChapterCascade(store, chapter.id);
  }
  store.books.delete(bookId);
}
```

- [ ] **Step 4: Run the cascade test to verify it passes**

Run:
```bash
npx vitest run packages/server/src/services/cascade.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Wire cascade into the books DELETE route**

In `packages/server/src/routes/books.ts`, replace the `delete` handler so book deletion cascades. Change the import block at the top to add cascade:
```ts
import { Router } from 'express';
import { newId, nowIso } from '../domain/ids.js';
import type { Book } from '../domain/types.js';
import { deleteBookCascade } from '../services/cascade.js';
import type { Store } from '../storage/store.js';
```
And replace the delete handler:
```ts
  router.delete('/:id', (req, res) => {
    deleteBookCascade(store, req.params.id);
    res.status(204).end();
  });
```

- [ ] **Step 6: Write the failing test for chapters routes**

Create `packages/server/src/routes/chapters.test.ts`:
```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { Store } from '../storage/store.js';

let dir: string;
let app: Awaited<ReturnType<typeof createApp>>;
let bookId: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-chapters-'));
  const store = await Store.open(dir);
  app = createApp(store);
  bookId = (await request(app).post('/api/books').send({ title: 'Book' })).body.id;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('chapters routes', () => {
  it('creates a chapter under a book with an auto-incremented order', async () => {
    const first = await request(app)
      .post(`/api/books/${bookId}/chapters`)
      .send({ title: 'Intro' });
    expect(first.status).toEqual(201);
    expect(first.body).toMatchObject({ bookId, title: 'Intro', order: 0 });

    const second = await request(app)
      .post(`/api/books/${bookId}/chapters`)
      .send({ title: 'Limits' });
    expect(second.body.order).toEqual(1);
  });

  it('lists chapters for a book ordered by order', async () => {
    await request(app).post(`/api/books/${bookId}/chapters`).send({ title: 'A' });
    await request(app).post(`/api/books/${bookId}/chapters`).send({ title: 'B' });
    const list = await request(app).get(`/api/books/${bookId}/chapters`);
    expect(list.status).toEqual(200);
    expect(list.body.map((c: { title: string }) => c.title)).toEqual(['A', 'B']);
  });

  it('rejects creating a chapter under an unknown book with 404', async () => {
    const res = await request(app).post('/api/books/nope/chapters').send({ title: 'X' });
    expect(res.status).toEqual(404);
  });

  it('PATCH and DELETE a chapter by id', async () => {
    const ch = (await request(app).post(`/api/books/${bookId}/chapters`).send({ title: 'A' })).body;
    const patched = await request(app)
      .patch(`/api/chapters/${ch.id}`)
      .send({ description: 'covers basics' });
    expect(patched.body.description).toEqual('covers basics');

    const del = await request(app).delete(`/api/chapters/${ch.id}`);
    expect(del.status).toEqual(204);
    const list = await request(app).get(`/api/books/${bookId}/chapters`);
    expect(list.body).toHaveLength(0);
  });
});
```

- [ ] **Step 7: Run the chapters test to verify it fails**

Run:
```bash
npx vitest run packages/server/src/routes/chapters.test.ts
```
Expected: FAIL — `./chapters.js` does not exist and the routes are not mounted.

- [ ] **Step 8: Implement the chapters router**

Create `packages/server/src/routes/chapters.ts`. Note: chapter creation is nested under a book (`/api/books/:bookId/chapters`), while PATCH/DELETE are flat (`/api/chapters/:id`) per the spec — so this file exports **two** routers.
```ts
import { Router } from 'express';
import { newId, nowIso } from '../domain/ids.js';
import type { Chapter } from '../domain/types.js';
import { deleteChapterCascade } from '../services/cascade.js';
import type { Store } from '../storage/store.js';

/** Nested under /api/books/:bookId/chapters — list + create. */
export function bookChaptersRouter(store: Store): Router {
  const router = Router({ mergeParams: true });

  router.get('/', (req, res) => {
    const bookId = (req.params as { bookId: string }).bookId;
    const chapters = store.chapters
      .getAll()
      .filter((c) => c.bookId === bookId)
      .sort((a, b) => a.order - b.order);
    res.json(chapters);
  });

  router.post('/', (req, res) => {
    const bookId = (req.params as { bookId: string }).bookId;
    if (!store.books.getById(bookId)) {
      res.status(404).json({ error: 'book not found' });
      return;
    }
    const { title, description } = req.body ?? {};
    if (typeof title !== 'string' || title.trim() === '') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const siblings = store.chapters.getAll().filter((c) => c.bookId === bookId);
    const nextOrder = siblings.reduce((max, c) => Math.max(max, c.order + 1), 0);
    const chapter: Chapter = {
      id: newId(),
      bookId,
      title: title.trim(),
      order: nextOrder,
      createdAt: nowIso(),
      ...(typeof description === 'string' && description.trim() !== ''
        ? { description: description.trim() }
        : {}),
    };
    res.status(201).json(store.chapters.create(chapter));
  });

  return router;
}

/** Flat /api/chapters/:id — patch + delete. */
export function chaptersRouter(store: Store): Router {
  const router = Router();

  router.patch('/:id', (req, res) => {
    if (!store.chapters.getById(req.params.id)) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const patch: Partial<Omit<Chapter, 'id'>> = {};
    const { title, description, order } = req.body ?? {};
    if (typeof title === 'string') patch.title = title.trim();
    if (typeof description === 'string') patch.description = description.trim();
    if (typeof order === 'number') patch.order = order;
    res.json(store.chapters.update(req.params.id, patch));
  });

  router.delete('/:id', (req, res) => {
    deleteChapterCascade(store, req.params.id);
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 9: Mount the chapter routers in index.ts**

In `packages/server/src/index.ts`, update the imports and add the two mounts inside `createApp` (after the books mount):
```ts
import { bookChaptersRouter, chaptersRouter } from './routes/chapters.js';
```
```ts
  app.use('/api/books', booksRouter(store));
  app.use('/api/books/:bookId/chapters', bookChaptersRouter(store));
  app.use('/api/chapters', chaptersRouter(store));
```

- [ ] **Step 10: Run the chapters and cascade tests to verify they pass**

Run:
```bash
npx vitest run packages/server/src/routes/chapters.test.ts packages/server/src/services/cascade.test.ts packages/server/src/routes/books.test.ts
```
Expected: PASS (all green — books still pass after the cascade change).

- [ ] **Step 11: Typecheck and commit**

Run:
```bash
npm run typecheck
```
Expected: PASS.
```bash
git add packages/server/src/services/cascade.ts packages/server/src/services/cascade.test.ts packages/server/src/routes/chapters.ts packages/server/src/routes/chapters.test.ts packages/server/src/routes/books.ts packages/server/src/index.ts
git commit -m "feat: add chapters CRUD nested under books with cascade delete"
```

---

## Task 6: Questions router (nested under chapters)

**Files:**
- Create: `packages/server/src/routes/questions.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/src/routes/questions.test.ts`

Manual question creation: `canonicalText` is required; `source` defaults to `{ kind: 'text', rawText: <canonicalText> }` (the raw backing for a hand-typed question is the typed text itself). `label` is optional. `relevance`/`nextReviewDate` are not set here.

- [ ] **Step 1: Write the failing test for questions routes**

Create `packages/server/src/routes/questions.test.ts`:
```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.js';
import { Store } from '../storage/store.js';

let dir: string;
let app: Awaited<ReturnType<typeof createApp>>;
let chapterId: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-questions-'));
  const store = await Store.open(dir);
  app = createApp(store);
  const bookId = (await request(app).post('/api/books').send({ title: 'Book' })).body.id;
  chapterId = (await request(app).post(`/api/books/${bookId}/chapters`).send({ title: 'Ch' })).body
    .id;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('questions routes', () => {
  it('creates a manual question with a text source derived from canonicalText', async () => {
    const res = await request(app)
      .post(`/api/chapters/${chapterId}/questions`)
      .send({ canonicalText: '\\int x\\,dx', label: '2.4' });
    expect(res.status).toEqual(201);
    expect(res.body).toMatchObject({
      chapterId,
      canonicalText: '\\int x\\,dx',
      label: '2.4',
      source: { kind: 'text', rawText: '\\int x\\,dx' },
    });
  });

  it('rejects a question with empty canonicalText (400)', async () => {
    const res = await request(app).post(`/api/chapters/${chapterId}/questions`).send({ label: '1' });
    expect(res.status).toEqual(400);
  });

  it('rejects creation under an unknown chapter (404)', async () => {
    const res = await request(app)
      .post('/api/chapters/nope/questions')
      .send({ canonicalText: 'x' });
    expect(res.status).toEqual(404);
  });

  it('lists questions for a chapter', async () => {
    await request(app).post(`/api/chapters/${chapterId}/questions`).send({ canonicalText: 'a' });
    await request(app).post(`/api/chapters/${chapterId}/questions`).send({ canonicalText: 'b' });
    const list = await request(app).get(`/api/chapters/${chapterId}/questions`);
    expect(list.status).toEqual(200);
    expect(list.body).toHaveLength(2);
  });

  it('PATCH edits canonicalText and label; DELETE removes it', async () => {
    const q = (
      await request(app).post(`/api/chapters/${chapterId}/questions`).send({ canonicalText: 'a' })
    ).body;
    const patched = await request(app)
      .patch(`/api/questions/${q.id}`)
      .send({ canonicalText: 'a + b', label: '3.1' });
    expect(patched.body).toMatchObject({ canonicalText: 'a + b', label: '3.1' });

    const del = await request(app).delete(`/api/questions/${q.id}`);
    expect(del.status).toEqual(204);
    const list = await request(app).get(`/api/chapters/${chapterId}/questions`);
    expect(list.body).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run packages/server/src/routes/questions.test.ts
```
Expected: FAIL — `./questions.js` does not exist and routes are not mounted.

- [ ] **Step 3: Implement the questions router**

Create `packages/server/src/routes/questions.ts`. Like chapters, this exports two routers (nested create/list + flat patch/delete):
```ts
import { Router } from 'express';
import { newId, nowIso } from '../domain/ids.js';
import type { Question } from '../domain/types.js';
import type { Store } from '../storage/store.js';

/** Nested under /api/chapters/:chapterId/questions — list + manual create. */
export function chapterQuestionsRouter(store: Store): Router {
  const router = Router({ mergeParams: true });

  router.get('/', (req, res) => {
    const chapterId = (req.params as { chapterId: string }).chapterId;
    res.json(store.questions.getAll().filter((q) => q.chapterId === chapterId));
  });

  router.post('/', (req, res) => {
    const chapterId = (req.params as { chapterId: string }).chapterId;
    if (!store.chapters.getById(chapterId)) {
      res.status(404).json({ error: 'chapter not found' });
      return;
    }
    const { canonicalText, label } = req.body ?? {};
    if (typeof canonicalText !== 'string' || canonicalText.trim() === '') {
      res.status(400).json({ error: 'canonicalText is required' });
      return;
    }
    const text = canonicalText.trim();
    const question: Question = {
      id: newId(),
      chapterId,
      canonicalText: text,
      source: { kind: 'text', rawText: text },
      createdAt: nowIso(),
      ...(typeof label === 'string' && label.trim() !== '' ? { label: label.trim() } : {}),
    };
    res.status(201).json(store.questions.create(question));
  });

  return router;
}

/** Flat /api/questions/:id — patch + delete. */
export function questionsRouter(store: Store): Router {
  const router = Router();

  router.patch('/:id', (req, res) => {
    if (!store.questions.getById(req.params.id)) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const patch: Partial<Omit<Question, 'id'>> = {};
    const { canonicalText, label } = req.body ?? {};
    if (typeof canonicalText === 'string') patch.canonicalText = canonicalText.trim();
    if (typeof label === 'string') patch.label = label.trim();
    res.json(store.questions.update(req.params.id, patch));
  });

  router.delete('/:id', (req, res) => {
    store.questions.delete(req.params.id);
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 4: Mount the question routers in index.ts**

In `packages/server/src/index.ts`, add the import and the two mounts (after the chapters mounts):
```ts
import { chapterQuestionsRouter, questionsRouter } from './routes/questions.js';
```
```ts
  app.use('/api/chapters/:chapterId/questions', chapterQuestionsRouter(store));
  app.use('/api/questions', questionsRouter(store));
```

- [ ] **Step 5: Run the questions test to verify it passes**

Run:
```bash
npx vitest run packages/server/src/routes/questions.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 6: Full server test run + typecheck**

Run:
```bash
npm run typecheck && npm test
```
Expected: PASS — every server test green.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/questions.ts packages/server/src/routes/questions.test.ts packages/server/src/index.ts
git commit -m "feat: add questions CRUD nested under chapters"
```

---

## Task 7: Book tree endpoint (book + nested chapters + questions in one request)

**Files:**
- Create: `packages/server/src/services/tree.ts`
- Modify: `packages/server/src/routes/books.ts`
- Test: `packages/server/src/services/tree.test.ts`

The Manage UI's master/detail navigation pairs with this single-request tree.

- [ ] **Step 1: Write the failing test for the tree assembler**

Create `packages/server/src/services/tree.test.ts`:
```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../storage/store.js';
import { buildBookTree } from './tree.js';

let dir: string;
let store: Store;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-tree-'));
  store = await Store.open(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('buildBookTree', () => {
  it('returns undefined for an unknown book', () => {
    expect(buildBookTree(store, 'nope')).toBeUndefined();
  });

  it('nests chapters (ordered) and their questions under the book', () => {
    const book = store.books.create({ id: 'b1', title: 'B', createdAt: 't' });
    store.chapters.create({ id: 'c2', bookId: 'b1', title: 'Second', order: 1, createdAt: 't' });
    store.chapters.create({ id: 'c1', bookId: 'b1', title: 'First', order: 0, createdAt: 't' });
    store.questions.create({
      id: 'q1',
      chapterId: 'c1',
      canonicalText: 'x',
      source: { kind: 'text', rawText: 'x' },
      createdAt: 't',
    });

    const tree = buildBookTree(store, book.id);
    expect(tree?.title).toEqual('B');
    expect(tree?.chapters.map((c) => c.title)).toEqual(['First', 'Second']);
    expect(tree?.chapters[0]?.questions).toHaveLength(1);
    expect(tree?.chapters[1]?.questions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run packages/server/src/services/tree.test.ts
```
Expected: FAIL — cannot resolve `./tree.js`.

- [ ] **Step 3: Implement the tree assembler**

Create `packages/server/src/services/tree.ts`:
```ts
import type { Book, Chapter, Question } from '../domain/types.js';
import type { Store } from '../storage/store.js';

export interface ChapterTree extends Chapter {
  questions: Question[];
}

export interface BookTree extends Book {
  chapters: ChapterTree[];
}

/** Assemble a book with its chapters (ordered) and each chapter's questions. */
export function buildBookTree(store: Store, bookId: string): BookTree | undefined {
  const book = store.books.getById(bookId);
  if (!book) return undefined;

  const chapters = store.chapters
    .getAll()
    .filter((c) => c.bookId === bookId)
    .sort((a, b) => a.order - b.order)
    .map<ChapterTree>((c) => ({
      ...c,
      questions: store.questions.getAll().filter((q) => q.chapterId === c.id),
    }));

  return { ...book, chapters };
}
```

- [ ] **Step 4: Run the tree test to verify it passes**

Run:
```bash
npx vitest run packages/server/src/services/tree.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Add the /tree route and test it**

First append a test to `packages/server/src/routes/books.test.ts` (inside the existing `describe('books routes', ...)` block, before its closing `});`):
```ts
  it('GET :id/tree returns the book with nested chapters and questions', async () => {
    const bookId = (await request(app).post('/api/books').send({ title: 'Tree' })).body.id;
    const chapterId = (
      await request(app).post(`/api/books/${bookId}/chapters`).send({ title: 'Ch' })
    ).body.id;
    await request(app).post(`/api/chapters/${chapterId}/questions`).send({ canonicalText: 'x' });

    const res = await request(app).get(`/api/books/${bookId}/tree`);
    expect(res.status).toEqual(200);
    expect(res.body.chapters).toHaveLength(1);
    expect(res.body.chapters[0].questions).toHaveLength(1);
  });
```

Then in `packages/server/src/routes/books.ts`, add the import:
```ts
import { buildBookTree } from '../services/tree.js';
```
And add this route **before** the `router.get('/:id', ...)` handler (so `/:id/tree` is matched as its own route — Express matches in registration order, and `/:id` would otherwise swallow nothing here, but registering `/:id/tree` explicitly is clearest):
```ts
  router.get('/:id/tree', (req, res) => {
    const tree = buildBookTree(store, req.params.id);
    if (!tree) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(tree);
  });
```

- [ ] **Step 6: Run the books test to verify it passes**

Run:
```bash
npx vitest run packages/server/src/routes/books.test.ts
```
Expected: PASS (6 tests — the 5 original plus the tree test).

- [ ] **Step 7: Full test run, typecheck, commit**

Run:
```bash
npm run typecheck && npm test
```
Expected: PASS.
```bash
git add packages/server/src/services/tree.ts packages/server/src/services/tree.test.ts packages/server/src/routes/books.ts packages/server/src/routes/books.test.ts
git commit -m "feat: add book tree endpoint"
```

---

## Task 8: Client API layer + DTO types

**Files:**
- Create: `packages/client/src/api/types.ts`
- Create: `packages/client/src/api/client.ts`

Pure fetch wrappers, no DOM. These are exercised by the UI tasks rather than unit tests (the server routes are already well-tested); keep them thin so there's little to test in isolation.

- [ ] **Step 1: Create the client DTO types**

Create `packages/client/src/api/types.ts` (duplicated from the server domain — see conventions):
```ts
export interface QuestionSource {
  kind: 'image' | 'text';
  imagePath?: string;
  rawText?: string;
}

export interface Book {
  id: string;
  title: string;
  author?: string;
  learningGoal?: string;
  createdAt: string;
}

export interface Chapter {
  id: string;
  bookId: string;
  title: string;
  description?: string;
  order: number;
  createdAt: string;
}

export interface Question {
  id: string;
  chapterId: string;
  label?: string;
  canonicalText: string;
  source: QuestionSource;
  createdAt: string;
}

export interface ChapterTree extends Chapter {
  questions: Question[];
}

export interface BookTree extends Book {
  chapters: ChapterTree[];
}
```

- [ ] **Step 2: Create the typed API client**

Create `packages/client/src/api/client.ts`:
```ts
import type { Book, BookTree, Chapter, Question } from './types.js';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function noContent(res: Response): Promise<void> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
}

export const api = {
  // Books
  listBooks: () => fetch('/api/books').then((r) => json<Book[]>(r)),
  getBookTree: (id: string) => fetch(`/api/books/${id}/tree`).then((r) => json<BookTree>(r)),
  createBook: (body: { title: string }) =>
    fetch('/api/books', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<Book>(r)),
  updateBook: (id: string, patch: Partial<Pick<Book, 'title' | 'author' | 'learningGoal'>>) =>
    fetch(`/api/books/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => json<Book>(r)),
  deleteBook: (id: string) => fetch(`/api/books/${id}`, { method: 'DELETE' }).then(noContent),

  // Chapters
  createChapter: (bookId: string, body: { title: string }) =>
    fetch(`/api/books/${bookId}/chapters`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<Chapter>(r)),
  updateChapter: (id: string, patch: Partial<Pick<Chapter, 'title' | 'description' | 'order'>>) =>
    fetch(`/api/chapters/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => json<Chapter>(r)),
  deleteChapter: (id: string) =>
    fetch(`/api/chapters/${id}`, { method: 'DELETE' }).then(noContent),

  // Questions
  createQuestion: (chapterId: string, body: { canonicalText: string; label?: string }) =>
    fetch(`/api/chapters/${chapterId}/questions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<Question>(r)),
  updateQuestion: (id: string, patch: Partial<Pick<Question, 'canonicalText' | 'label'>>) =>
    fetch(`/api/questions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => json<Question>(r)),
  deleteQuestion: (id: string) =>
    fetch(`/api/questions/${id}`, { method: 'DELETE' }).then(noContent),
};
```

- [ ] **Step 3: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: PASS. (No runtime change yet — nothing imports `api`. The client tsconfig has DOM libs so `fetch`/`Response` resolve.)

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/api/
git commit -m "feat: add client API layer and DTO types"
```

---

## Task 9: Three-tab app shell (Manage functional placeholder; Learn/Practice stubs)

**Files:**
- Create: `packages/client/src/styles.css`
- Create: `packages/client/src/tabs/shell.ts`
- Create: `packages/client/src/tabs/learn.ts`
- Create: `packages/client/src/tabs/practice.ts`
- Create: `packages/client/src/tabs/manage.ts`
- Modify: `packages/client/src/main.ts`
- Modify: `packages/client/index.html`

This task delivers the visible shell: three tabs that switch panels, with Manage showing a placeholder for now. CRUD UI fills it in over the next tasks.

- [ ] **Step 1: Create the stylesheet**

Create `packages/client/src/styles.css`:
```css
:root {
  --bg: #fff;
  --fg: #1a1a1a;
  --muted: #666;
  --border: #ddd;
  --accent: #2563eb;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, sans-serif;
  color: var(--fg);
  background: var(--bg);
}

#app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.tab-panels {
  flex: 1;
  padding: 1rem;
}

.tab-bar {
  display: flex;
  border-top: 1px solid var(--border);
}

.tab-bar button {
  flex: 1;
  padding: 0.75rem;
  border: none;
  background: none;
  font-size: 1rem;
  color: var(--muted);
  cursor: pointer;
}

.tab-bar button.active {
  color: var(--accent);
  font-weight: 600;
}

/* PC: tabs on top */
@media (min-width: 768px) {
  #app {
    flex-direction: column-reverse;
  }
  .tab-bar {
    border-top: none;
    border-bottom: 1px solid var(--border);
  }
}

.row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--border);
}

.row .grow {
  flex: 1;
}

button.link {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  padding: 0;
  font: inherit;
}

.add-row {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.add-row input {
  flex: 1;
  padding: 0.4rem;
}

.crumb {
  color: var(--muted);
  margin-bottom: 0.75rem;
}

.crumb button {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  padding: 0;
  font: inherit;
}

pre.latex {
  margin: 0;
  white-space: pre-wrap;
  font-family: ui-monospace, monospace;
  background: #f6f6f6;
  padding: 0.3rem 0.5rem;
  border-radius: 4px;
}
```

- [ ] **Step 2: Create the Learn and Practice stub panels**

Create `packages/client/src/tabs/learn.ts`:
```ts
/** Stub panel — the Learn (grading) sub-project is not built yet. */
export function renderLearn(host: HTMLElement): void {
  host.innerHTML = `
    <h2>Learn</h2>
    <p>Coming soon — work through new questions and get them graded.</p>
  `;
}
```

Create `packages/client/src/tabs/practice.ts`:
```ts
/** Stub panel — the Practice (spaced repetition) sub-project is not built yet. */
export function renderPractice(host: HTMLElement): void {
  host.innerHTML = `
    <h2>Practice</h2>
    <p>Coming soon — review questions the system surfaces for you.</p>
  `;
}
```

- [ ] **Step 3: Create a temporary Manage placeholder**

Create `packages/client/src/tabs/manage.ts` (this is replaced with real CRUD in Task 10; a placeholder now keeps the shell self-contained and observable):
```ts
/** Manage tab — content management. Filled in by later tasks. */
export function renderManage(host: HTMLElement): void {
  host.innerHTML = `
    <h2>Manage</h2>
    <p>Books, chapters and questions will appear here.</p>
  `;
}
```

- [ ] **Step 4: Create the tab shell**

Create `packages/client/src/tabs/shell.ts`:
```ts
import { renderLearn } from './learn.js';
import { renderManage } from './manage.js';
import { renderPractice } from './practice.js';

type TabId = 'learn' | 'practice' | 'manage';

const TABS: { id: TabId; label: string; render: (host: HTMLElement) => void }[] = [
  { id: 'learn', label: 'Learn', render: renderLearn },
  { id: 'practice', label: 'Practice', render: renderPractice },
  { id: 'manage', label: 'Manage', render: renderManage },
];

/** Build the three-tab shell into the given root element. */
export function mountShell(root: HTMLElement): void {
  root.innerHTML = '';

  const panels = document.createElement('div');
  panels.className = 'tab-panels';

  const bar = document.createElement('nav');
  bar.className = 'tab-bar';

  let active: TabId = 'manage';

  function select(id: TabId): void {
    active = id;
    for (const btn of bar.querySelectorAll('button')) {
      btn.classList.toggle('active', btn.dataset.tab === id);
    }
    const tab = TABS.find((t) => t.id === id)!;
    tab.render(panels);
  }

  for (const tab of TABS) {
    const btn = document.createElement('button');
    btn.textContent = tab.label;
    btn.dataset.tab = tab.id;
    btn.addEventListener('click', () => select(tab.id));
    bar.appendChild(btn);
  }

  root.appendChild(panels);
  root.appendChild(bar);
  select(active);
}
```

- [ ] **Step 5: Rewrite main.ts to bootstrap the shell**

Replace the entire contents of `packages/client/src/main.ts` with:
```ts
import './styles.css';
import { mountShell } from './tabs/shell.js';

const root = document.getElementById('app');
if (root) mountShell(root);
```

- [ ] **Step 6: Update index.html to a bare app root**

Replace the `<body>` contents of `packages/client/index.html` so the script owns the DOM:
```html
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
```
(Leave the `<head>` as-is. The stylesheet is imported by `main.ts`, so no `<link>` is needed — Vite handles the CSS import.)

- [ ] **Step 7: Verify in the browser**

Run from repo root:
```bash
npm run dev
```
Open http://localhost:5173. Expected: three tabs (Learn / Practice / Manage), Manage active by default showing the placeholder. Click each tab — the panel switches and the active tab highlights. Resize the window below/above 768px — on wide screens tabs sit at the top, on narrow at the bottom. Stop with Ctrl-C.

- [ ] **Step 8: Typecheck and commit**

Run:
```bash
npm run typecheck
```
Expected: PASS.
```bash
git add packages/client/src/styles.css packages/client/src/tabs/ packages/client/src/main.ts packages/client/index.html
git commit -m "feat: add three-tab app shell with Learn/Practice stubs"
```

---

## Task 10: Books pane — list + inline add (Manage drill-down level 1)

**Files:**
- Create: `packages/client/src/manage/books-pane.ts`
- Rewrite: `packages/client/src/tabs/manage.ts`

The Manage tab becomes a drill-down stack. This task implements the top level: list books, inline add-row to create, click a book to drill in (the chapters pane lands next task — for now drilling in shows a placeholder).

- [ ] **Step 1: Implement the books pane**

Create `packages/client/src/manage/books-pane.ts`:
```ts
import { api } from '../api/client.js';
import type { Book } from '../api/types.js';

/**
 * Render the list of books with an inline add-row.
 * @param host element to render into
 * @param onOpen called with a book when the user drills into it
 */
export async function renderBooksPane(
  host: HTMLElement,
  onOpen: (book: Book) => void,
): Promise<void> {
  host.innerHTML = '<h2>Books</h2><div class="list">loading…</div>';
  const list = host.querySelector<HTMLDivElement>('.list')!;

  async function refresh(): Promise<void> {
    const books = await api.listBooks();
    list.innerHTML = '';
    for (const book of books) {
      const row = document.createElement('div');
      row.className = 'row';

      const open = document.createElement('button');
      open.className = 'link grow';
      open.style.textAlign = 'left';
      open.textContent = book.title;
      open.addEventListener('click', () => onOpen(book));

      const del = document.createElement('button');
      del.className = 'link';
      del.textContent = 'delete';
      del.addEventListener('click', async () => {
        await api.deleteBook(book.id);
        await refresh();
      });

      row.append(open, del);
      list.appendChild(row);
    }
  }

  const addRow = document.createElement('div');
  addRow.className = 'add-row';
  const input = document.createElement('input');
  input.placeholder = 'New book title…';
  const addBtn = document.createElement('button');
  addBtn.textContent = 'Add';

  async function add(): Promise<void> {
    const title = input.value.trim();
    if (!title) return;
    await api.createBook({ title });
    input.value = '';
    await refresh();
    input.focus();
  }

  addBtn.addEventListener('click', add);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void add();
  });

  addRow.append(input, addBtn);
  host.appendChild(addRow);

  await refresh();
}
```

- [ ] **Step 2: Rewrite the Manage tab as a drill-down stack**

Replace the entire contents of `packages/client/src/tabs/manage.ts` with:
```ts
import type { Book } from '../api/types.js';
import { renderBooksPane } from '../manage/books-pane.js';

type View = { level: 'books' } | { level: 'book'; book: Book };

/** Manage tab — master/detail drill-down (Books → Book → Chapter → Questions). */
export function renderManage(host: HTMLElement): void {
  let view: View = { level: 'books' };

  function show(): void {
    host.innerHTML = '';
    const pane = document.createElement('div');
    host.appendChild(pane);

    if (view.level === 'books') {
      void renderBooksPane(pane, (book) => {
        view = { level: 'book', book };
        show();
      });
    } else {
      renderBookPlaceholder(pane, view.book, () => {
        view = { level: 'books' };
        show();
      });
    }
  }

  show();
}

/** Temporary — replaced by the chapters pane in the next task. */
function renderBookPlaceholder(host: HTMLElement, book: Book, onBack: () => void): void {
  const crumb = document.createElement('div');
  crumb.className = 'crumb';
  const back = document.createElement('button');
  back.textContent = '← Books';
  back.addEventListener('click', onBack);
  crumb.appendChild(back);

  const title = document.createElement('h2');
  title.textContent = book.title;

  host.append(crumb, title);
}
```

- [ ] **Step 3: Verify in the browser**

Run:
```bash
npm run dev
```
Open http://localhost:5173 (Manage tab active). Expected: a "Books" heading, an empty list, and an add-row. Type a title, press Enter or click Add → the book appears in the list and the input clears. Add a second. Click a book title → drills into a placeholder showing the title and a "← Books" back button; click back → returns to the list. Click "delete" on a book → it disappears. Confirm `data/books.json` reflects the changes. Stop with Ctrl-C.

- [ ] **Step 4: Typecheck and commit**

Run:
```bash
npm run typecheck
```
Expected: PASS.
```bash
git add packages/client/src/manage/books-pane.ts packages/client/src/tabs/manage.ts
git commit -m "feat: add books pane with inline add and drill-down"
```

---

## Task 11: Chapters pane — list + inline add (Manage drill-down level 2)

**Files:**
- Create: `packages/client/src/manage/chapters-pane.ts`
- Modify: `packages/client/src/tabs/manage.ts`

Drilling into a book lists its chapters (via the `/tree` endpoint), with inline add and drill-in to a chapter (questions pane lands next task).

- [ ] **Step 1: Implement the chapters pane**

Create `packages/client/src/manage/chapters-pane.ts`:
```ts
import { api } from '../api/client.js';
import type { Book, ChapterTree } from '../api/types.js';

/**
 * Render a book's chapters with an inline add-row.
 * @param host element to render into
 * @param book the book being viewed
 * @param onBack return to the books list
 * @param onOpen drill into a chapter
 */
export async function renderChaptersPane(
  host: HTMLElement,
  book: Book,
  onBack: () => void,
  onOpen: (chapter: ChapterTree) => void,
): Promise<void> {
  host.innerHTML = '';

  const crumb = document.createElement('div');
  crumb.className = 'crumb';
  const back = document.createElement('button');
  back.textContent = '← Books';
  back.addEventListener('click', onBack);
  crumb.appendChild(back);

  const title = document.createElement('h2');
  title.textContent = book.title;

  const list = document.createElement('div');
  list.className = 'list';
  list.textContent = 'loading…';

  host.append(crumb, title, list);

  async function refresh(): Promise<void> {
    const tree = await api.getBookTree(book.id);
    list.innerHTML = '';
    for (const chapter of tree.chapters) {
      const row = document.createElement('div');
      row.className = 'row';

      const open = document.createElement('button');
      open.className = 'link grow';
      open.style.textAlign = 'left';
      const count = chapter.questions.length;
      open.textContent = `${chapter.title} (${count})`;
      open.addEventListener('click', () => onOpen(chapter));

      const del = document.createElement('button');
      del.className = 'link';
      del.textContent = 'delete';
      del.addEventListener('click', async () => {
        await api.deleteChapter(chapter.id);
        await refresh();
      });

      row.append(open, del);
      list.appendChild(row);
    }
  }

  const addRow = document.createElement('div');
  addRow.className = 'add-row';
  const input = document.createElement('input');
  input.placeholder = 'New chapter title…';
  const addBtn = document.createElement('button');
  addBtn.textContent = 'Add';

  async function add(): Promise<void> {
    const t = input.value.trim();
    if (!t) return;
    await api.createChapter(book.id, { title: t });
    input.value = '';
    await refresh();
    input.focus();
  }

  addBtn.addEventListener('click', add);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void add();
  });
  addRow.append(input, addBtn);
  host.appendChild(addRow);

  await refresh();
}
```

- [ ] **Step 2: Wire the chapters pane into the Manage drill-down**

In `packages/client/src/tabs/manage.ts`, update the imports and the `View` type and `show()` to add the `book` level. Replace the import line and the `View` type:
```ts
import type { Book, ChapterTree } from '../api/types.js';
import { renderBooksPane } from '../manage/books-pane.js';
import { renderChaptersPane } from '../manage/chapters-pane.js';
```
```ts
type View =
  | { level: 'books' }
  | { level: 'book'; book: Book }
  | { level: 'chapter'; book: Book; chapter: ChapterTree };
```
Then replace the `else` branch in `show()` (which currently calls `renderBookPlaceholder`) with a proper dispatch, and delete the `renderBookPlaceholder` function:
```ts
    if (view.level === 'books') {
      void renderBooksPane(pane, (book) => {
        view = { level: 'book', book };
        show();
      });
    } else if (view.level === 'book') {
      const current = view;
      void renderChaptersPane(
        pane,
        current.book,
        () => {
          view = { level: 'books' };
          show();
        },
        (chapter) => {
          view = { level: 'chapter', book: current.book, chapter };
          show();
        },
      );
    } else {
      renderChapterPlaceholder(pane, view.book, view.chapter, () => {
        view = { level: 'book', book: (view as { book: Book }).book };
        show();
      });
    }
```
Add a temporary chapter placeholder at the bottom of the file (replaced next task):
```ts
function renderChapterPlaceholder(
  host: HTMLElement,
  book: Book,
  chapter: ChapterTree,
  onBack: () => void,
): void {
  const crumb = document.createElement('div');
  crumb.className = 'crumb';
  const back = document.createElement('button');
  back.textContent = `← ${book.title}`;
  back.addEventListener('click', onBack);
  crumb.appendChild(back);

  const title = document.createElement('h2');
  title.textContent = chapter.title;

  host.append(crumb, title);
}
```

> Note: the `view` variable is reassigned across closures, so capture `current = view` inside each branch (as shown) before using its narrowed fields in async callbacks — this avoids stale/!widened-type reads. The back-from-chapter handler re-derives the book from the chapter view; since each `show()` rebuilds from the live `view`, this is safe.

- [ ] **Step 3: Verify in the browser**

Run:
```bash
npm run dev
```
Open http://localhost:5173. Add a book (or use an existing one), drill in. Expected: the book title, an empty chapters list, and an add-row. Add a chapter → it appears as "Title (0)". Add another. Click "← Books" → back to the list. Drill back in → chapters persist. Click a chapter → placeholder with the chapter title and a "← <book title>" back button. Delete a chapter → it disappears. Stop with Ctrl-C.

- [ ] **Step 4: Typecheck and commit**

Run:
```bash
npm run typecheck
```
Expected: PASS.
```bash
git add packages/client/src/manage/chapters-pane.ts packages/client/src/tabs/manage.ts
git commit -m "feat: add chapters pane with inline add and drill-down"
```

---

## Task 12: Questions pane — list, inline add, inline edit with raw-LaTeX toggle (Manage drill-down level 3)

**Files:**
- Create: `packages/client/src/manage/questions-pane.ts`
- Modify: `packages/client/src/tabs/manage.ts`

The deepest level: a chapter's questions. Each question shows its **raw LaTeX source** in a read view; clicking edit swaps to a textarea (raw-edit) with save/cancel; an inline add-row creates new questions. (KaTeX rendering of the read view is Step 3 / a later plan — here the read view is raw source in a `<pre>`.)

- [ ] **Step 1: Implement the questions pane**

Create `packages/client/src/manage/questions-pane.ts`:
```ts
import { api } from '../api/client.js';
import type { ChapterTree, Question } from '../api/types.js';

/**
 * Render a chapter's questions: raw-LaTeX read view with an edit toggle, plus inline add.
 * @param host element to render into
 * @param chapter the chapter being viewed (carries its initial questions)
 * @param bookTitle for the breadcrumb
 * @param onBack return to the chapters list
 */
export async function renderQuestionsPane(
  host: HTMLElement,
  chapter: ChapterTree,
  bookTitle: string,
  onBack: () => void,
): Promise<void> {
  host.innerHTML = '';

  const crumb = document.createElement('div');
  crumb.className = 'crumb';
  const back = document.createElement('button');
  back.textContent = `← ${bookTitle}`;
  back.addEventListener('click', onBack);
  crumb.appendChild(back);

  const title = document.createElement('h2');
  title.textContent = chapter.title;

  const list = document.createElement('div');
  list.className = 'list';
  list.textContent = 'loading…';

  host.append(crumb, title, list);

  async function refresh(): Promise<void> {
    // Re-fetch via the tree so we always show server truth.
    const tree = await api.getBookTree(chapter.bookId);
    const fresh = tree.chapters.find((c) => c.id === chapter.id);
    const questions = fresh?.questions ?? [];
    list.innerHTML = '';
    for (const q of questions) list.appendChild(renderQuestionRow(q, refresh));
  }

  const addRow = document.createElement('div');
  addRow.className = 'add-row';
  const input = document.createElement('input');
  input.placeholder = 'New question LaTeX…';
  const labelInput = document.createElement('input');
  labelInput.placeholder = 'label (e.g. 2.4)';
  labelInput.style.maxWidth = '8rem';
  const addBtn = document.createElement('button');
  addBtn.textContent = 'Add';

  async function add(): Promise<void> {
    const canonicalText = input.value.trim();
    if (!canonicalText) return;
    const label = labelInput.value.trim();
    await api.createQuestion(chapter.id, label ? { canonicalText, label } : { canonicalText });
    input.value = '';
    labelInput.value = '';
    await refresh();
    input.focus();
  }

  addBtn.addEventListener('click', add);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void add();
  });
  addRow.append(labelInput, input, addBtn);
  host.appendChild(addRow);

  await refresh();
}

/** One question row: read mode (raw LaTeX in a <pre>) ⇄ edit mode (textarea). */
function renderQuestionRow(q: Question, refresh: () => Promise<void>): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row';

  function readMode(): void {
    row.innerHTML = '';
    const body = document.createElement('div');
    body.className = 'grow';

    if (q.label) {
      const lbl = document.createElement('strong');
      lbl.textContent = `${q.label} `;
      body.appendChild(lbl);
    }
    const pre = document.createElement('pre');
    pre.className = 'latex';
    pre.textContent = q.canonicalText; // raw source — rendering deferred to a later plan
    body.appendChild(pre);

    const edit = document.createElement('button');
    edit.className = 'link';
    edit.textContent = 'edit';
    edit.addEventListener('click', editMode);

    const del = document.createElement('button');
    del.className = 'link';
    del.textContent = 'delete';
    del.addEventListener('click', async () => {
      await api.deleteQuestion(q.id);
      await refresh();
    });

    row.append(body, edit, del);
  }

  function editMode(): void {
    row.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'grow';

    const labelInput = document.createElement('input');
    labelInput.placeholder = 'label';
    labelInput.value = q.label ?? '';
    labelInput.style.maxWidth = '8rem';

    const textarea = document.createElement('textarea');
    textarea.value = q.canonicalText;
    textarea.rows = 3;
    textarea.style.width = '100%';

    const save = document.createElement('button');
    save.className = 'link';
    save.textContent = 'save';
    save.addEventListener('click', async () => {
      const canonicalText = textarea.value.trim();
      if (!canonicalText) return;
      const label = labelInput.value.trim();
      await api.updateQuestion(q.id, { canonicalText, label });
      await refresh();
    });

    const cancel = document.createElement('button');
    cancel.className = 'link';
    cancel.textContent = 'cancel';
    cancel.addEventListener('click', readMode);

    wrap.append(labelInput, textarea);
    row.append(wrap, save, cancel);
    textarea.focus();
  }

  readMode();
  return row;
}
```

- [ ] **Step 2: Wire the questions pane into the Manage drill-down**

In `packages/client/src/tabs/manage.ts`, add the import and replace the `renderChapterPlaceholder` call + function with the real pane. Add the import near the top:
```ts
import { renderQuestionsPane } from '../manage/questions-pane.js';
```
Replace the final `else` branch in `show()` (the one calling `renderChapterPlaceholder`) with:
```ts
    } else {
      const current = view;
      void renderQuestionsPane(pane, current.chapter, current.book.title, () => {
        view = { level: 'book', book: current.book };
        show();
      });
    }
```
Delete the now-unused `renderChapterPlaceholder` function.

- [ ] **Step 3: Verify in the browser**

Run:
```bash
npm run dev
```
Open http://localhost:5173. Drill Books → a book → a chapter. Expected: the chapter title, an empty questions list, and an add-row (label + LaTeX inputs + Add). Add a question with LaTeX like `\int_0^1 x^2\,dx` and label `2.4` → it appears showing the raw source in a monospace box with the label. Click "edit" → the row becomes a textarea + label input with save/cancel; change the text, save → the read view updates. Cancel leaves it unchanged. Delete removes it. Navigate back up and down — questions persist (check `data/questions.json`). Confirm the chapter list's "(N)" count reflects the question count after going back. Stop with Ctrl-C.

- [ ] **Step 4: Typecheck and commit**

Run:
```bash
npm run typecheck
```
Expected: PASS.
```bash
git add packages/client/src/manage/questions-pane.ts packages/client/src/tabs/manage.ts
git commit -m "feat: add questions pane with inline add and raw-LaTeX edit"
```

---

## Task 13: Final integration pass — full suite, end-to-end smoke, README touch-up

**Files:**
- Modify: `README.md` (if it lacks a "run it" section)
- No new source unless the smoke test surfaces a bug.

- [ ] **Step 1: Run the full test suite and typecheck**

Run from repo root:
```bash
npm run typecheck && npm test
```
Expected: PASS — every test green (ids, json-collection, store, cascade, tree, books, chapters, questions routes).

- [ ] **Step 2: End-to-end smoke in the browser**

Run:
```bash
npm run dev
```
Walk the full flow at http://localhost:5173:
1. Manage tab → add two books.
2. Drill into one → add two chapters.
3. Drill into a chapter → add three questions (one with a label, one with multiline LaTeX, one minimal).
4. Edit a question's LaTeX, save; edit its label, save.
5. Delete a question; delete a chapter; delete a book.
6. Switch to Learn and Practice tabs → confirm the stub panels show.
7. Reload the page → confirm all surviving data is still present (proves write-through + reload).

Expected: every step behaves; on-disk `data/books.json`, `data/chapters.json`, `data/questions.json` match what's on screen. Stop with Ctrl-C.

- [ ] **Step 3: Fix anything the smoke test surfaced**

If a bug appears, write a failing test that reproduces it (route bug → a supertest case; UI bug → fix and re-verify in the browser), fix it, confirm green, and commit separately with a `fix:` message. If nothing surfaced, skip to Step 4.

- [ ] **Step 4: Ensure the README documents how to run it**

Read `README.md` first. It already has a "Getting started" section covering `npm install`, `npm run dev`, both ports (5173 client, 3001 server), and a `npm test` row in the scripts table — so don't duplicate those. **One known stale line to fix:** the "Getting started" section says *"Open http://localhost:5173 — the page should show `Server status: ok`."* That status page is replaced by the tab shell in Task 9. Update that sentence to describe the new landing experience, e.g.:

```
Open http://localhost:5173 — you'll see the three-tab shell (Learn / Practice / Manage) with the Manage tab active for adding books, chapters, and questions.
```

If you spot any other drift introduced by this plan, fix it; otherwise make only this change.

- [ ] **Step 5: Commit any README changes**

```bash
git add README.md
git commit -m "docs: document running the dev server and tests"
```

- [ ] **Step 6: Final confirmation**

Run once more:
```bash
npm run typecheck && npm test
```
Expected: PASS. Registration (Step 1 of the foundation sub-project) is complete: three-tab shell with Manage functional, storage layer with write-through persistence, and full inline CRUD for books/chapters/questions showing raw LaTeX. Backups, LLM ingestion, and KaTeX rendering remain for follow-up plans.

---

## Self-Review notes (for the executor)

- **Spec coverage:** three-tab shell with Manage functional + Learn/Practice stubbed (Task 9); storage layer with in-memory working set + write-through (Tasks 2–3); inline CRUD for books/chapters/questions (Tasks 10–12); raw LaTeX shown, no rendering (Task 12); REST endpoints incl. `/tree` (Tasks 4–7). **Deliberately omitted vs. spec:** `BackupStore` + retention timer (deferred per the planning decision — note this when the foundation is called "done"); `extract` endpoint and LLM layer (Step 2, separate plan).
- **Type consistency:** server domain types (`Book`/`Chapter`/`Question`/`QuestionSource`) are duplicated verbatim into the client `api/types.ts`; `Repository<T>` method names (`getAll`/`getById`/`create`/`update`/`delete`) are used identically across collection, store, services, and routes; `createApp`, `Store.open`, `JsonCollection.open`, `buildBookTree`, `deleteBookCascade`/`deleteChapterCascade` names are consistent across their definition and call sites.
- **`exactOptionalPropertyTypes` discipline:** every optional field is set via conditional spread (key omitted when absent), never assigned `undefined`. Watch for this in any new code.
