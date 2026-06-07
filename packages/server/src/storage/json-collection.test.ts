import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonCollection } from './json-collection.js';

interface Widget {
  id: string;
  name: string;
  size?: number;
}

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-coll-'));
  file = join(dir, 'widgets.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('JsonCollection', () => {
  it('starts empty when the file does not exist', async () => {
    const coll = await JsonCollection.open<Widget>(file);
    expect(coll.getAll()).toEqual([]);
  });

  it('creates, reads, updates and deletes, writing through to disk', async () => {
    const coll = await JsonCollection.open<Widget>(file);

    const created = coll.create({ id: 'w1', name: 'alpha' });
    expect(created).toEqual({ id: 'w1', name: 'alpha' });
    expect(coll.getById('w1')).toEqual({ id: 'w1', name: 'alpha' });

    const updated = coll.update('w1', { name: 'beta', size: 3 });
    expect(updated).toEqual({ id: 'w1', name: 'beta', size: 3 });

    coll.delete('w1');
    expect(coll.getById('w1')).toBeUndefined();
    expect(coll.getAll()).toEqual([]);
  });

  it('persists across reopen (write-through + reload)', async () => {
    const coll = await JsonCollection.open<Widget>(file);
    coll.create({ id: 'w1', name: 'alpha' });
    coll.create({ id: 'w2', name: 'gamma' });

    const reopened = await JsonCollection.open<Widget>(file);
    expect(reopened.getAll()).toHaveLength(2);
    expect(reopened.getById('w2')).toEqual({ id: 'w2', name: 'gamma' });

    // The on-disk file is valid JSON.
    const raw = await readFile(file, 'utf8');
    expect(JSON.parse(raw)).toHaveLength(2);
  });

  it('update throws on unknown id', async () => {
    const coll = await JsonCollection.open<Widget>(file);
    expect(() => coll.update('nope', { name: 'x' })).toThrow(/nope/);
  });

  it('getAll returns copies, not internal references', async () => {
    const coll = await JsonCollection.open<Widget>(file);
    coll.create({ id: 'w1', name: 'alpha' });
    const all = coll.getAll();
    all[0]!.name = 'mutated';
    expect(coll.getById('w1')!.name).toEqual('alpha');
  });
});
