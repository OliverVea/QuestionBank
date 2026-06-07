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
