import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Repository } from './repository.js';

/**
 * One JSON file ↔ one in-memory array holding every customer's rows. Reads serve from
 * memory, scoped to the requesting `customerId`; every mutation rewrites the whole file
 * (write-through), so a restart recovers the latest state. Returned values are
 * deep-cloned so callers cannot mutate the working set.
 *
 * The contract is async (Promise-returning) for a future SQL/DDB backend; this in-memory
 * impl does its work synchronously and resolves immediately. Scoping here is a filter on
 * `customerId`; SQL would use `WHERE customer_id = ?` and DynamoDB a partition key.
 */
export class JsonCollection<T extends { id: string; customerId: string }>
  implements Repository<T>
{
  private items: T[];

  private constructor(
    private readonly filePath: string,
    initial: T[],
  ) {
    this.items = initial;
  }

  /** Load the file (missing file ⇒ empty collection) and return a ready collection. */
  static async open<T extends { id: string; customerId: string }>(
    filePath: string,
  ): Promise<JsonCollection<T>> {
    let initial: T[] = [];
    try {
      const raw = await readFile(filePath, 'utf8');
      initial = JSON.parse(raw) as T[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return new JsonCollection<T>(filePath, initial);
  }

  async getAll(customerId: string): Promise<T[]> {
    return this.items.filter((it) => it.customerId === customerId).map(clone);
  }

  async getById(customerId: string, id: string): Promise<T | undefined> {
    const found = this.items.find((it) => it.id === id && it.customerId === customerId);
    return found ? clone(found) : undefined;
  }

  async create(customerId: string, entity: T): Promise<T> {
    if (entity.customerId !== customerId) {
      throw new Error(`create: entity customerId ${entity.customerId} != ${customerId}`);
    }
    this.items.push(clone(entity));
    this.flush();
    return clone(entity);
  }

  async update(
    customerId: string,
    id: string,
    patch: Partial<Omit<T, 'id' | 'customerId'>>,
  ): Promise<T> {
    // Wrong-owner is not-found: match on both id and customerId, so a foreign id throws
    // the same not-found error as a missing one and never reveals the other owner.
    const idx = this.items.findIndex((it) => it.id === id && it.customerId === customerId);
    if (idx === -1) throw new Error(`update: no entity with id ${id}`);
    const merged = { ...this.items[idx]!, ...patch } as T;
    this.items[idx] = merged;
    this.flush();
    return clone(merged);
  }

  async delete(customerId: string, id: string): Promise<void> {
    const before = this.items.length;
    // Wrong-owner is a no-op: only rows owned by this customer are removed.
    this.items = this.items.filter((it) => !(it.id === id && it.customerId === customerId));
    if (this.items.length !== before) this.flush();
  }

  async reorder(customerId: string, orderedIds: string[]): Promise<void> {
    const owned = this.items.filter((it) => it.customerId === customerId);
    const others = this.items.filter((it) => it.customerId !== customerId);
    const byId = new Map(owned.map((it) => [it.id, it]));
    const sorted: T[] = [];
    for (const id of orderedIds) {
      const item = byId.get(id);
      if (item) { sorted.push(item); byId.delete(id); }
    }
    // Append any owned items not mentioned in orderedIds.
    for (const remaining of byId.values()) sorted.push(remaining);
    this.items = [...others, ...sorted];
    this.flush();
  }

  // Synchronous write-through: the mutation does not return until the whole
  // array is on disk, so a reopen always sees the latest state. The architecture
  // assumes a single server instance with no concurrent writers, so a blocking
  // write per mutation is acceptable.
  private flush(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.items, null, 2), 'utf8');
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
