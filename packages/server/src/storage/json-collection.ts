import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Repository } from './repository.js';

/**
 * One JSON file ↔ one in-memory array. Reads serve from memory; every mutation
 * rewrites the whole file (write-through), so a restart recovers the latest state.
 * Returned values are deep-cloned so callers cannot mutate the working set.
 */
export class JsonCollection<T extends { id: string }> implements Repository<T> {
  private items: T[];

  private constructor(
    private readonly filePath: string,
    initial: T[],
  ) {
    this.items = initial;
  }

  /** Load the file (missing file ⇒ empty collection) and return a ready collection. */
  static async open<T extends { id: string }>(filePath: string): Promise<JsonCollection<T>> {
    let initial: T[] = [];
    try {
      const raw = await readFile(filePath, 'utf8');
      initial = JSON.parse(raw) as T[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return new JsonCollection<T>(filePath, initial);
  }

  getAll(): T[] {
    return this.items.map(clone);
  }

  getById(id: string): T | undefined {
    const found = this.items.find((it) => it.id === id);
    return found ? clone(found) : undefined;
  }

  create(entity: T): T {
    this.items.push(clone(entity));
    this.flush();
    return clone(entity);
  }

  update(id: string, patch: Partial<Omit<T, 'id'>>): T {
    const idx = this.items.findIndex((it) => it.id === id);
    if (idx === -1) throw new Error(`update: no entity with id ${id}`);
    const merged = { ...this.items[idx]!, ...patch } as T;
    this.items[idx] = merged;
    this.flush();
    return clone(merged);
  }

  delete(id: string): void {
    const before = this.items.length;
    this.items = this.items.filter((it) => it.id !== id);
    if (this.items.length !== before) this.flush();
  }

  // Synchronous write-through: the mutation does not return until the whole
  // array is on disk, so a reopen always sees the latest state. The architecture
  // assumes a single server instance with no concurrent writers, so a blocking
  // write per mutation is acceptable and keeps the Repository contract synchronous.
  private flush(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.items, null, 2), 'utf8');
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
