import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../storage/store.js';
import { rekeyCustomer } from './rekey-customer.js';

const OLD = 'legacy-uid';
const NEW = '11111111-2222-3333-4444-555555555555';

let dir: string;

async function seed(customerId: string): Promise<void> {
  const store = await Store.open(dir);
  const book = await store.books.create(customerId, {
    id: 'b1', customerId, title: 'T', author: 'A',
    questionIds: [], createdAt: '2026-01-01T00:00:00.000Z',
  } as Parameters<typeof store.books.create>[1]);
  await store.questions.create(customerId, {
    id: 'q1', customerId, bookId: book.id, label: '1', canonicalText: 'q',
    source: { kind: 'text' as const, rawText: 'q' },
    createdAt: '2026-01-01T00:00:00.000Z',
  } as Parameters<typeof store.questions.create>[1]);
  await store.attempts.create(customerId, {
    id: 'a1', customerId, questionId: 'q1', answer: 'x',
    recommendedGrade: 'correct', rating: 'correct', issues: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  } as Parameters<typeof store.attempts.create>[1]);
  await store.skips.create(customerId, {
    id: 's1', customerId, questionId: 'q1',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-02T00:00:00.000Z',
  } as Parameters<typeof store.skips.create>[1]);
  await store.figures.create(customerId, {
    id: 'f1', customerId, questionId: 'q1',
    printedLabel: 'Figure 1.1', confidence: 'high',
    createdAt: '2026-01-01T00:00:00.000Z',
  } as Parameters<typeof store.figures.create>[1]);
  await store.settings.create(customerId, {
    id: customerId, customerId, daysGoal: 5, problemsGoal: 10, pauseEvery: 3,
  } as Parameters<typeof store.settings.create>[1]);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-rekey-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('rekeyCustomer', () => {
  it('moves every row from OLD to NEW and remaps settings id', async () => {
    await seed(OLD);

    const summary = await rekeyCustomer({ dataDir: dir, oldId: OLD, newId: NEW });
    expect(summary.changed.books).toBe(1);
    expect(summary.changed.questions).toBe(1);
    expect(summary.changed.attempts).toBe(1);
    expect(summary.changed.skips).toBe(1);
    expect(summary.changed.figures).toBe(1);
    expect(summary.changed.settings).toBe(1);

    const store = await Store.open(dir);
    expect(await store.books.getAll(NEW)).toHaveLength(1);
    expect(await store.questions.getAll(NEW)).toHaveLength(1);
    expect(await store.attempts.getAll(NEW)).toHaveLength(1);
    expect(await store.skips.getAll(NEW)).toHaveLength(1);
    expect(await store.figures.getAll(NEW)).toHaveLength(1);
    expect(await store.books.getAll(OLD)).toHaveLength(0);
    expect(await store.questions.getAll(OLD)).toHaveLength(0);
    expect(await store.attempts.getAll(OLD)).toHaveLength(0);

    const settings = await store.settings.getById(NEW, NEW);
    expect(settings?.customerId).toBe(NEW);
    expect(settings?.id).toBe(NEW);
  });

  it('is idempotent — a second run changes nothing', async () => {
    await seed(OLD);
    await rekeyCustomer({ dataDir: dir, oldId: OLD, newId: NEW });
    const second = await rekeyCustomer({ dataDir: dir, oldId: OLD, newId: NEW });
    expect(second.changed.books).toBe(0);
    expect(second.changed.settings).toBe(0);
  });

  it('dry-run reports counts without writing', async () => {
    await seed(OLD);
    const summary = await rekeyCustomer({ dataDir: dir, oldId: OLD, newId: NEW, dryRun: true });
    expect(summary.changed.books).toBe(1);

    const store = await Store.open(dir);
    expect(await store.books.getAll(OLD)).toHaveLength(1); // unchanged on disk
    expect(await store.books.getAll(NEW)).toHaveLength(0);
  });

  it('refuses to create a duplicate settings row when newId already exists', async () => {
    await seed(OLD);
    // The new user already has a settings row (e.g. logged in before migration).
    const store = await Store.open(dir);
    await store.settings.create(NEW, {
      id: NEW, customerId: NEW, daysGoal: 1, problemsGoal: 1, pauseEvery: 1,
    } as Parameters<typeof store.settings.create>[1]);
    await expect(rekeyCustomer({ dataDir: dir, oldId: OLD, newId: NEW })).rejects.toThrow(/duplicate/i);
  });
});
