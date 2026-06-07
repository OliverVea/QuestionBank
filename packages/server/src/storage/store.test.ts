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
  it('opens four empty collections in a fresh data dir', async () => {
    const store = await Store.open(dir);
    expect(store.books.getAll()).toEqual([]);
    expect(store.chapters.getAll()).toEqual([]);
    expect(store.questions.getAll()).toEqual([]);
    expect(store.attempts.getAll()).toEqual([]);
  });

  it('opens an attempts collection that round-trips', async () => {
    const store = await Store.open(dir);
    const created = store.attempts.create({
      id: 'a1',
      questionId: 'q1',
      imagePaths: ['images/x.jpg'],
      answerText: 'x',
      transcription: 'z^3 = 1',
      recommendedGrade: 'partial',
      rating: 'correct',
      issues: [{ severity: 'medium', description: 'sign error' }],
      createdAt: '2026-06-07T00:00:00.000Z',
    });
    expect(created.id).toEqual('a1');
    expect(store.attempts.getAll()).toHaveLength(1);
    expect(store.attempts.getAll()[0]?.imagePaths).toEqual(['images/x.jpg']);
  });

  it('persists each entity type to its own file', async () => {
    const store = await Store.open(dir);
    store.books.create({ id: 'b1', title: 'Calc', createdAt: '2026-06-06T00:00:00.000Z' });

    const reopened = await Store.open(dir);
    expect(reopened.books.getById('b1')?.title).toEqual('Calc');
    expect(reopened.chapters.getAll()).toEqual([]);
  });
});
