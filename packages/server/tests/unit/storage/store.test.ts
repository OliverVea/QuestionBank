import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '@/storage/store.js';

const C = 'local';

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
    expect(await store.books.getAll(C)).toEqual([]);
    expect(await store.questions.getAll(C)).toEqual([]);
    expect(await store.attempts.getAll(C)).toEqual([]);
  });

  it('opens an attempts collection that round-trips', async () => {
    const store = await Store.open(dir);
    const created = await store.attempts.create(C, {
      id: 'a1',
      customerId: C,
      questionId: 'q1',
      answer: 'z^3 = 1',
      recommendedGrade: 'partial',
      rating: 'correct',
      issues: [{ severity: 'medium', description: 'sign error' }],
      createdAt: '2026-06-07T00:00:00.000Z',
    });
    expect(created.id).toEqual('a1');
    expect(await store.attempts.getAll(C)).toHaveLength(1);
    expect((await store.attempts.getAll(C))[0]?.answer).toEqual('z^3 = 1');
  });

  it('persists each entity type to its own file', async () => {
    const store = await Store.open(dir);
    await store.books.create(C, {
      id: 'b1',
      customerId: C,
      title: 'Calc',
      questionIds: [],
      createdAt: '2026-06-06T00:00:00.000Z',
    });

    const reopened = await Store.open(dir);
    expect((await reopened.books.getById(C, 'b1'))?.title).toEqual('Calc');
    expect(await reopened.questions.getAll(C)).toEqual([]);
  });
});
