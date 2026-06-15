import { describe, expect, it } from 'vitest';
import type { QuestionWithSummary } from '@/lib/types';
import { chapterTotal, groupByPath, splitLabel } from '@/lib/problem-grouping';

const q = (label: string): QuestionWithSummary => ({
  id: `q-${label}`,
  bookId: 'b',
  label,
  canonicalText: label,
  summary: { mastery: 'new', readiness: 'ready', grades: [] },
});

describe('splitLabel', () => {
  it('splits chapter + section from a 3-part label', () => {
    expect(splitLabel('1.A.3')).toEqual({ chapter: '1', section: 'A' });
  });
  it('treats a 2-part label as a direct chapter problem (no section)', () => {
    expect(splitLabel('2.3')).toEqual({ chapter: '2', section: null });
  });
  it('treats a single segment as a direct chapter problem', () => {
    expect(splitLabel('3')).toEqual({ chapter: '3', section: null });
  });
  it('returns null for empty/missing labels', () => {
    expect(splitLabel('')).toBeNull();
    expect(splitLabel(null)).toBeNull();
  });
});

describe('groupByPath', () => {
  it('buckets into chapters; direct problems before lettered subsections', () => {
    // Input arrives already path-sorted (server contract).
    const problems = [q('1.A.1'), q('1.A.2'), q('1.B.1'), q('2.3'), q('2.A.1')];
    const chapters = groupByPath(problems);

    expect(chapters.map((c) => c.name)).toEqual(['1', '2']);

    const [c1, c2] = chapters;
    expect(c1!.direct).toHaveLength(0);
    expect([...c1!.sections.keys()]).toEqual(['A', 'B']);
    expect(c1!.sections.get('A')!.map((e) => e.p.label)).toEqual(['1.A.1', '1.A.2']);

    // Chapter 2 has a direct problem (2.3) AND a subsection (A).
    expect(c2!.direct.map((e) => e.p.label)).toEqual(['2.3']);
    expect([...c2!.sections.keys()]).toEqual(['A']);
  });

  it('keeps each entry’s original flat index (for row links)', () => {
    const problems = [q('1.A.1'), q('2.3'), q('1.B.1')];
    const chapters = groupByPath(problems);
    const c2 = chapters.find((c) => c.name === '2')!;
    expect(c2.direct[0]!.i).toBe(1); // 2.3 was index 1 in the flat list
  });

  it('puts unlabelled problems in an Ungrouped chapter at the end', () => {
    const problems = [q('1.A.1'), q(''), q('2.3')];
    const chapters = groupByPath(problems);
    expect(chapters.map((c) => c.name)).toEqual(['1', '2', null]);
    expect(chapters[chapters.length - 1]!.direct).toHaveLength(1);
  });

  it('chapterTotal counts direct + all subsection problems', () => {
    const [c1] = groupByPath([q('1.A.1'), q('1.A.2'), q('1.B.1'), q('1.5')]);
    expect(chapterTotal(c1!)).toBe(4);
  });
});
