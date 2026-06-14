import { describe, expect, it } from 'vitest';
import type { Question } from '../domain/types.js';
import { comparePaths, compareProblems } from './problem-order.js';

const sign = (n: number): -1 | 0 | 1 => (n < 0 ? -1 : n > 0 ? 1 : 0);

describe('comparePaths', () => {
  it('numeric-aware within a segment: 1.A.2 before 1.A.10', () => {
    expect(sign(comparePaths('1.A.2', '1.A.10'))).toBe(-1);
  });

  it('numeric-aware at the top level: 2 before 10', () => {
    expect(sign(comparePaths('2', '10'))).toBe(-1);
  });

  it('shorter prefix sorts first: 1.A before 1.A.1', () => {
    expect(sign(comparePaths('1.A', '1.A.1'))).toBe(-1);
  });

  it('numeric segment sorts before alpha at the same depth: 1 before Warm-ups', () => {
    expect(sign(comparePaths('1', 'Warm-ups'))).toBe(-1);
  });

  it('two alpha segments compare case-insensitively: A before B', () => {
    expect(sign(comparePaths('1.A.1', '1.B.1'))).toBe(-1);
  });

  it('is reflexive (equal paths compare 0)', () => {
    expect(comparePaths('1.A.3', '1.A.3')).toBe(0);
  });
});

describe('compareProblems', () => {
  const q = (id: string, label: string, createdAt: string): Question => ({
    id,
    customerId: 'c',
    bookId: 'b',
    label,
    canonicalText: 'x',
    source: { kind: 'text' },
    createdAt,
  });

  it('orders by path first', () => {
    const a = q('a', '1.A.2', '2026-01-02T00:00:00.000Z');
    const b = q('b', '1.A.10', '2026-01-01T00:00:00.000Z'); // older but later path
    expect(sign(compareProblems(a, b))).toBe(-1);
  });

  it('breaks an equal-path tie by createdAt ascending', () => {
    const a = q('a', '1.A.1', '2026-01-01T00:00:00.000Z');
    const b = q('b', '1.A.1', '2026-01-02T00:00:00.000Z');
    expect(sign(compareProblems(a, b))).toBe(-1);
  });

  it('breaks an equal-path, equal-createdAt tie by id', () => {
    const a = q('a', '1.A.1', '2026-01-01T00:00:00.000Z');
    const b = q('b', '1.A.1', '2026-01-01T00:00:00.000Z');
    expect(sign(compareProblems(a, b))).toBe(-1);
  });

  it('sorts a mixed list into path order', () => {
    const list = [
      q('z', '2.3', '2026-01-01T00:00:00.000Z'),
      q('y', '1.A.10', '2026-01-01T00:00:00.000Z'),
      q('x', '1.A.2', '2026-01-01T00:00:00.000Z'),
      q('w', '1.B.1', '2026-01-01T00:00:00.000Z'),
      q('v', '10', '2026-01-01T00:00:00.000Z'),
    ];
    const ordered = [...list].sort(compareProblems).map((p) => p.label);
    expect(ordered).toEqual(['1.A.2', '1.A.10', '1.B.1', '2.3', '10']);
  });
});
