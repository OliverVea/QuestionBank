import type { Question } from '../domain/types.js';

/**
 * Derived display order for a book's problems — the single source of truth.
 *
 * Order is derived from the dotted-path `label` (`1.A.3`), NOT from any stored
 * order: `Book.questionIds` survives only as membership + reconcile state. The
 * sort key is (path, createdAt, id); see comparePaths for the path rules.
 *
 * Pure and total. Shared by the questions GET (display) and learn enumeration so
 * every consumer agrees by construction.
 */

const ALL_DIGITS = /^\d+$/;

/**
 * Compare one path segment against another. An all-digit segment sorts
 * numerically; a numeric segment always sorts BEFORE an alpha one at the same
 * depth; two alpha segments compare case-insensitively (ties broken by raw
 * value so the order is total).
 */
function compareSegment(a: string, b: string): number {
  const aNum = ALL_DIGITS.test(a);
  const bNum = ALL_DIGITS.test(b);
  if (aNum && bNum) {
    const d = Number(a) - Number(b);
    return d !== 0 ? d : 0;
  }
  if (aNum) return -1; // numeric before alpha
  if (bNum) return 1;
  const lc = a.toLowerCase().localeCompare(b.toLowerCase());
  if (lc !== 0) return lc;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Compare two dotted-path labels segment-by-segment after `split('.')`:
 * - numeric-aware per segment (`1.A.2` < `1.A.10`, chapter `2` < `10`);
 * - numeric segments sort before alpha at the same depth;
 * - a shorter path that is a prefix of a longer one sorts first (`1.A` < `1.A.1`).
 */
export function comparePaths(aLabel: string, bLabel: string): number {
  const a = aLabel.split('.');
  const b = bLabel.split('.');
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = compareSegment(a[i]!, b[i]!);
    if (c !== 0) return c;
  }
  return a.length - b.length; // shorter prefix first
}

/**
 * Total order over a book's problems: path, then createdAt ascending (problems
 * may share a full path), then id for determinism.
 */
export function compareProblems(a: Question, b: Question): number {
  const byPath = comparePaths(a.label, b.label);
  if (byPath !== 0) return byPath;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
