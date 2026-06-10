import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../storage/store.js';
import { deleteBookCascade, deleteChapterCascade } from './cascade.js';

const C = 'local';

let dir: string;
let store: Store;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-cascade-'));
  store = await Store.open(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function seed(): Promise<{ bookId: string; chapterId: string }> {
  const book = await store.books.create(C, { id: 'b1', customerId: C, title: 'B', createdAt: 't' });
  const chapter = await store.chapters.create(C, {
    id: 'c1',
    customerId: C,
    bookId: book.id,
    title: 'C',
    order: 0,
    createdAt: 't',
  });
  await store.questions.create(C, {
    id: 'q1',
    customerId: C,
    chapterId: chapter.id,
    canonicalText: 'x',
    source: { kind: 'text', rawText: 'x' },
    createdAt: 't',
  });
  return { bookId: book.id, chapterId: chapter.id };
}

describe('cascade', () => {
  it('deleteChapterCascade removes the chapter and its questions', async () => {
    const { chapterId } = await seed();
    await deleteChapterCascade(store, C, chapterId);
    expect(await store.chapters.getById(C, chapterId)).toBeUndefined();
    expect(await store.questions.getAll(C)).toEqual([]);
  });

  it('deleteBookCascade removes the book, its chapters and their questions', async () => {
    const { bookId } = await seed();
    await deleteBookCascade(store, C, bookId);
    expect(await store.books.getById(C, bookId)).toBeUndefined();
    expect(await store.chapters.getAll(C)).toEqual([]);
    expect(await store.questions.getAll(C)).toEqual([]);
  });
});
