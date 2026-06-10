import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonCollection } from '@/storage/json-collection.js';

interface Widget {
  id: string;
  customerId: string;
  name: string;
  size?: number;
}

const A = 'cust-a';
const B = 'cust-b';

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
    expect(await coll.getAll(A)).toEqual([]);
  });

  it('creates, reads, updates and deletes within a customer, writing through to disk', async () => {
    const coll = await JsonCollection.open<Widget>(file);

    const created = await coll.create(A, { id: 'w1', customerId: A, name: 'alpha' });
    expect(created).toEqual({ id: 'w1', customerId: A, name: 'alpha' });
    expect(await coll.getById(A, 'w1')).toEqual({ id: 'w1', customerId: A, name: 'alpha' });

    const updated = await coll.update(A, 'w1', { name: 'beta', size: 3 });
    expect(updated).toEqual({ id: 'w1', customerId: A, name: 'beta', size: 3 });

    await coll.delete(A, 'w1');
    expect(await coll.getById(A, 'w1')).toBeUndefined();
    expect(await coll.getAll(A)).toEqual([]);
  });

  it('scopes reads to the requesting customer', async () => {
    const coll = await JsonCollection.open<Widget>(file);
    await coll.create(A, { id: 'w1', customerId: A, name: 'alpha' });
    await coll.create(B, { id: 'w2', customerId: B, name: 'beta' });

    expect((await coll.getAll(A)).map((w) => w.id)).toEqual(['w1']);
    expect((await coll.getAll(B)).map((w) => w.id)).toEqual(['w2']);
  });

  it('treats a wrong-owner entity as not-found across read/update/delete', async () => {
    const coll = await JsonCollection.open<Widget>(file);
    await coll.create(A, { id: 'w1', customerId: A, name: 'alpha' });

    // B cannot see, patch, or remove A's widget.
    expect(await coll.getById(B, 'w1')).toBeUndefined();
    await expect(coll.update(B, 'w1', { name: 'hijacked' })).rejects.toThrow(/w1/);
    await coll.delete(B, 'w1'); // no-op
    expect(await coll.getById(A, 'w1')).toEqual({ id: 'w1', customerId: A, name: 'alpha' });
  });

  it('rejects creating an entity whose customerId does not match the argument', async () => {
    const coll = await JsonCollection.open<Widget>(file);
    await expect(coll.create(A, { id: 'w1', customerId: B, name: 'x' })).rejects.toThrow();
  });

  it('persists across reopen (write-through + reload)', async () => {
    const coll = await JsonCollection.open<Widget>(file);
    await coll.create(A, { id: 'w1', customerId: A, name: 'alpha' });
    await coll.create(A, { id: 'w2', customerId: A, name: 'gamma' });

    const reopened = await JsonCollection.open<Widget>(file);
    expect(await reopened.getAll(A)).toHaveLength(2);
    expect(await reopened.getById(A, 'w2')).toEqual({ id: 'w2', customerId: A, name: 'gamma' });

    // The on-disk file is valid JSON.
    const raw = await readFile(file, 'utf8');
    expect(JSON.parse(raw)).toHaveLength(2);
  });

  it('update throws on unknown id', async () => {
    const coll = await JsonCollection.open<Widget>(file);
    await expect(coll.update(A, 'nope', { name: 'x' })).rejects.toThrow(/nope/);
  });

  it('getAll returns copies, not internal references', async () => {
    const coll = await JsonCollection.open<Widget>(file);
    await coll.create(A, { id: 'w1', customerId: A, name: 'alpha' });
    const all = await coll.getAll(A);
    all[0]!.name = 'mutated';
    expect((await coll.getById(A, 'w1'))!.name).toEqual('alpha');
  });
});
