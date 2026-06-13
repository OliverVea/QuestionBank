/** The minimal problem shape the tree projection needs. */
export interface TreeProblem {
  id: string;
  /** The dotted-path label, e.g. "1.A.3". */
  label: string;
  /** ISO timestamp — orders problems that share a full path. */
  createdAt: string;
}

/** One node of the derived section tree. Internal nodes have children; leaves carry problems. */
export interface TreeNode {
  /** This level's path segment, e.g. "1", "A", "Warm-ups". */
  segment: string;
  children: TreeNode[];
  /** Problems whose full path ends at this node, oldest-first. */
  problems: TreeProblem[];
}

/**
 * Project a flat problem list into an arbitrary-depth tree by splitting each label on ".".
 * First-seen order is preserved at each level. Problems sharing a full path collect at one
 * leaf, ordered by createdAt. A label with no "." is a single-segment (top-level) node.
 * Pure: no storage, no mutation of inputs.
 */
export function buildTree(problems: TreeProblem[]): TreeNode[] {
  const roots: TreeNode[] = [];

  function childBySegment(siblings: TreeNode[], segment: string): TreeNode {
    let node = siblings.find((n) => n.segment === segment);
    if (!node) {
      node = { segment, children: [], problems: [] };
      siblings.push(node);
    }
    return node;
  }

  for (const problem of problems) {
    const segments = problem.label.split('.');
    let level = roots;
    let node: TreeNode | undefined;
    for (const segment of segments) {
      node = childBySegment(level, segment);
      level = node.children;
    }
    // node is the leaf for this problem's full path.
    node!.problems.push(problem);
  }

  // Order each leaf's co-located problems oldest-first (stable for equal timestamps).
  function sortLeaves(nodes: TreeNode[]): void {
    for (const n of nodes) {
      if (n.problems.length > 1) {
        n.problems.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
      }
      sortLeaves(n.children);
    }
  }
  sortLeaves(roots);

  return roots;
}
