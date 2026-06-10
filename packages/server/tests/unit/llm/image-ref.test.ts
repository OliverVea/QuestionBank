import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bufferImage, fileImage } from '@/llm/image-ref.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-imageref-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ImageRef', () => {
  it('bufferImage carries its mimeType and returns its bytes', async () => {
    const ref = bufferImage(Buffer.from('hello'), 'image/png');
    expect(ref.mimeType).toEqual('image/png');
    expect((await ref.load()).toString()).toEqual('hello');
  });

  it('fileImage reads bytes from disk lazily', async () => {
    const path = join(dir, 'a.jpg');
    await writeFile(path, 'jpegbytes');
    const ref = fileImage(path, 'image/jpeg');
    expect(ref.mimeType).toEqual('image/jpeg');
    expect((await ref.load()).toString()).toEqual('jpegbytes');
  });
});
