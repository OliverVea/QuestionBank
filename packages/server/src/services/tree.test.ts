import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../storage/store.js';
import { buildBookTree } from './tree.js';

const C = 'local';

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
  it('returns undefined for an unknown book', async () => {
    expect(await buildBookTree(store, C, 'nope')).toBeUndefined();
  });

  it('nests chapters (ordered) and their questions under the book', async () => {
    const book = await store.books.create(C, { id: 'b1', customerId: C, title: 'B', createdAt: 't' });
    await store.chapters.create(C, {
      id: 'c2',
      customerId: C,
      bookId: 'b1',
      title: 'Second',
      order: 1,
      createdAt: 't',
    });
    await store.chapters.create(C, {
      id: 'c1',
      customerId: C,
      bookId: 'b1',
      title: 'First',
      order: 0,
      createdAt: 't',
    });
    await store.questions.create(C, {
      id: 'q1',
      customerId: C,
      chapterId: 'c1',
      canonicalText: 'x',
      source: { kind: 'text', rawText: 'x' },
      createdAt: 't',
    });

    const tree = await buildBookTree(store, C, book.id);
    expect(tree?.title).toEqual('B');
    expect(tree?.chapters.map((c) => c.title)).toEqual(['First', 'Second']);
    expect(tree?.chapters[0]?.questions).toHaveLength(1);
    expect(tree?.chapters[1]?.questions).toEqual([]);
  });
});
