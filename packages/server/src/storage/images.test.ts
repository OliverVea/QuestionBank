import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImageStore } from './images.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-images-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ImageStore', () => {
  it('saves a buffer under images/ and returns a relative + absolute path', async () => {
    const store = new ImageStore(dir);
    const buf = Buffer.from('fake-png-bytes');
    const { imagePath, absolutePath } = await store.save(buf, 'png');

    // Relative path is under images/ with a uuid filename and the given extension.
    expect(imagePath).toMatch(/^images[/\\][0-9a-f-]{36}\.png$/);
    // The absolute path points at the same file and it exists on disk.
    await expect(access(absolutePath)).resolves.toBeUndefined();
    expect(await readFile(absolutePath)).toEqual(buf);
  });

  it('lazy-creates the images directory on first save', async () => {
    const store = new ImageStore(dir);
    // images/ does not exist yet.
    await expect(access(join(dir, 'images'))).rejects.toBeTruthy();
    await store.save(Buffer.from('x'), 'jpg');
    await expect(access(join(dir, 'images'))).resolves.toBeUndefined();
  });

  it('gives each saved image a distinct filename', async () => {
    const store = new ImageStore(dir);
    const a = await store.save(Buffer.from('a'), 'png');
    const b = await store.save(Buffer.from('b'), 'png');
    expect(a.imagePath).not.toEqual(b.imagePath);
  });
});
