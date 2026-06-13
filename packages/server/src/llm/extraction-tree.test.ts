import { describe, expect, it } from 'vitest';
import { buildTree, type TreeProblem } from './extraction-tree.js';

/** Minimal problem shape buildTree needs: id, the dotted label, and createdAt for ordering. */
function p(id: string, label: string, createdAt: string): TreeProblem {
  return { id, label, createdAt };
}

describe('buildTree', () => {
  it('reconstructs a multi-level tree from dotted paths', () => {
    const tree = buildTree([
      p('a', '1.A.1', '2026-01-01T00:00:00.000Z'),
      p('b', '1.A.2', '2026-01-02T00:00:00.000Z'),
      p('c', '1.B.1', '2026-01-03T00:00:00.000Z'),
      p('d', '2.1', '2026-01-04T00:00:00.000Z'),
      p('e', 'Warm-ups', '2026-01-05T00:00:00.000Z'),
    ]);
    // Top-level segments, in first-seen order.
    expect(tree.map((n) => n.segment)).toEqual(['1', '2', 'Warm-ups']);
    const chapter1 = tree[0];
    expect(chapter1.children.map((n) => n.segment)).toEqual(['A', 'B']);
    const sectionA = chapter1.children[0];
    // Leaf segments under 1.A are the final path segments.
    expect(sectionA.children.map((n) => n.segment)).toEqual(['1', '2']);
    // The leaves carry the problem ids.
    expect(sectionA.children[0].problems.map((q) => q.id)).toEqual(['a']);
    // A single-segment label is a top-level leaf carrying its problem.
    const warmups = tree[2];
    expect(warmups.problems.map((q) => q.id)).toEqual(['e']);
  });

  it('collects two problems sharing a full path at one leaf, ordered by createdAt', () => {
    const tree = buildTree([
      p('late', '1.A.3', '2026-01-09T00:00:00.000Z'),
      p('early', '1.A.3', '2026-01-01T00:00:00.000Z'),
    ]);
    const leaf = tree[0].children[0].children[0];
    expect(leaf.segment).toEqual('3');
    expect(leaf.problems.map((q) => q.id)).toEqual(['early', 'late']);
  });
});
