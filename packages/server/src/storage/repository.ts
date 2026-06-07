/** A typed entity store. Concrete implementations hide their backing (JSON now, SQL later). */
export interface Repository<T extends { id: string }> {
  getAll(): T[];
  getById(id: string): T | undefined;
  /** Persist a fully-formed entity (id already assigned by the caller). */
  create(entity: T): T;
  /** Shallow-merge `patch` into the stored entity; throws if id is unknown. */
  update(id: string, patch: Partial<Omit<T, 'id'>>): T;
  /** Remove the entity; no-op if id is unknown. */
  delete(id: string): void;
}
