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
