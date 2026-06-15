import type { QuestionWithSummary } from '@/lib/types';

/**
 * Fan the flat (server-sorted) problem list out into two levels for display:
 * chapter → (direct chapter problems, then lettered subsections). The dotted
 * path label IS the organizing concept; `1.A.1` nests under chapter 1 ▸ section A,
 * `2.3` is a direct child of chapter 2, an unlabelled problem falls into the
 * "Ungrouped" chapter.
 *
 * ORDER is the server's: the input arrives sorted by (path, createdAt, id), and
 * this only buckets — it never re-sorts problems. Within a chapter, the direct
 * problems come first, then subsections in first-seen (already path-sorted) order.
 * Two levels only (no deeper recursion); deeper segments stay on the row label.
 */

/** A problem paired with its original index in the flat list (for row links). */
export interface IndexedProblem {
  p: QuestionWithSummary;
  i: number;
}

export interface Chapter {
  /** Chapter segment (`1`, `2`, `Warm-ups`), or null for the Ungrouped bucket. */
  name: string | null;
  /** Problems that live directly at the chapter (e.g. `2.3`), in input order. */
  direct: IndexedProblem[];
  /** Lettered subsections (`A`, `B`, …) → their problems, in first-seen order. */
  sections: Map<string, IndexedProblem[]>;
}

interface Split {
  chapter: string;
  section: string | null;
}

/**
 * Split a label into its chapter + (optional) section for two-level grouping.
 * `1.A.3` → chapter 1, section A. `2.3` → chapter 2, no section (direct). `3` →
 * chapter 3, no section. Empty/missing → null (Ungrouped).
 */
export function splitLabel(label: string | null | undefined): Split | null {
  if (label == null || label === '') return null;
  const parts = String(label).split('.');
  const chapter = parts[0]!;
  if (parts.length >= 3) return { chapter, section: parts[1]! };
  return { chapter, section: null };
}

/** Total count of problems held by a chapter (direct + all subsections). */
export function chapterTotal(chapter: Chapter): number {
  let n = chapter.direct.length;
  for (const arr of chapter.sections.values()) n += arr.length;
  return n;
}

/**
 * Bucket the sorted problem list into chapters (preserving input order). The
 * Ungrouped chapter, if any, is moved to the end; all other chapters keep their
 * first-seen (server-sorted) order.
 */
export function groupByPath(problems: QuestionWithSummary[]): Chapter[] {
  const byKey = new Map<string, Chapter>();
  let ungrouped: Chapter | null = null;

  const chapterFor = (name: string): Chapter => {
    let c = byKey.get(name);
    if (!c) {
      c = { name, direct: [], sections: new Map() };
      byKey.set(name, c);
    }
    return c;
  };

  problems.forEach((p, i) => {
    const split = splitLabel(p.label);
    const entry: IndexedProblem = { p, i };
    if (!split) {
      ungrouped ??= { name: null, direct: [], sections: new Map() };
      ungrouped.direct.push(entry);
      return;
    }
    const chapter = chapterFor(split.chapter);
    if (split.section == null) {
      chapter.direct.push(entry);
    } else {
      const list = chapter.sections.get(split.section);
      if (list) list.push(entry);
      else chapter.sections.set(split.section, [entry]);
    }
  });

  const chapters = [...byKey.values()];
  if (ungrouped) chapters.push(ungrouped);
  return chapters;
}
