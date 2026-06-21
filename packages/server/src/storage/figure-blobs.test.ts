import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FigureBlobs } from './figure-blobs.js';

const UUID = '11111111-2222-3333-4444-555555555555';

let dir: string;
let blobs: FigureBlobs;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-blobs-'));
  blobs = await FigureBlobs.open(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FigureBlobs', () => {
  it('puts and reads back a crop at imgs/<id>.webp', async () => {
    await blobs.put(UUID, Buffer.from('webp-bytes'));
    const onDisk = await readFile(join(dir, 'imgs', `${UUID}.webp`));
    expect(onDisk.toString()).toEqual('webp-bytes');
    expect(blobs.path(UUID)).toEqual(join(dir, 'imgs', `${UUID}.webp`));
  });

  it('deletes a crop; missing file is a no-op', async () => {
    await blobs.put(UUID, Buffer.from('x'));
    await blobs.delete(UUID);
    await expect(readFile(join(dir, 'imgs', `${UUID}.webp`))).rejects.toThrow();
    // Second delete on the now-missing file must not throw.
    await expect(blobs.delete(UUID)).resolves.toBeUndefined();
  });

  it('rejects a non-UUID id before touching the filesystem (no traversal)', async () => {
    expect(() => blobs.path('../../books')).toThrow();
    await expect(blobs.put('../../books', Buffer.from('x'))).rejects.toThrow();
    await expect(blobs.delete('not-a-uuid')).rejects.toThrow();
    // The traversal target was never created.
    await expect(readFile(join(dir, '..', 'books'))).rejects.toThrow();
  });

  it('creates imgs/ on open even if it did not exist', async () => {
    // Writing a file proves the directory exists.
    await writeFile(join(dir, 'imgs', `${UUID}.webp`), 'ok');
    expect((await readFile(join(dir, 'imgs', `${UUID}.webp`))).toString()).toEqual('ok');
  });
});
