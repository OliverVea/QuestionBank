import { randomUUID } from 'node:crypto';

/** A fresh UUID for entity ids. */
export function newId(): string {
  return randomUUID();
}

/** Current time as an ISO-8601 string, for `createdAt` fields. */
export function nowIso(): string {
  return new Date().toISOString();
}
