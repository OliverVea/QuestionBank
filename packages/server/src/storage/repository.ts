/**
 * A typed, customer-scoped entity store. Concrete implementations hide their backing
 * (JSON now, SQL/DynamoDB later) and scope every operation to the leading `customerId`.
 *
 * The contract is async so a SQL/DDB backend (inherently async) is a drop-in later with
 * zero route/service churn; the in-memory JSON impl simply resolves immediately.
 *
 * Wrong-owner is not-found: an entity that exists but belongs to a different customer is
 * invisible — `getById` → undefined, `update` throws not-found, `delete` is a no-op — so a
 * caller can never learn another customer's entity exists, and existing 404 handling works
 * unchanged. `id` and `customerId` are immutable via `update` (both excluded from the patch).
 */
export interface Repository<T extends { id: string; customerId: string }> {
  getAll(customerId: string): Promise<T[]>;
  getById(customerId: string, id: string): Promise<T | undefined>;
  /** Persist a fully-formed entity (id already assigned). Its customerId must match the argument. */
  create(customerId: string, entity: T): Promise<T>;
  /** Shallow-merge `patch` into the stored entity; throws if id is unknown or owned by another customer. */
  update(
    customerId: string,
    id: string,
    patch: Partial<Omit<T, 'id' | 'customerId'>>,
  ): Promise<T>;
  /** Remove the entity; no-op if id is unknown or owned by another customer. */
  delete(customerId: string, id: string): Promise<void>;
}
