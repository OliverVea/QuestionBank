import type { Question } from '../domain/types.js';

/** One item in the incoming ordered list: an existing id to update, or no id to create. */
export interface IncomingQuestion {
  id?: string;
  label: string;
  canonicalText: string;
}

/** A field-limited update to an existing question (only label + text are client-editable). */
export interface QuestionUpdate {
  id: string;
  label: string;
  canonicalText: string;
}

/** The computed effect of a batch save, ready for the route to apply atomically. */
export interface BatchSavePlan {
  create: Question[];
  update: QuestionUpdate[];
  deleteIds: string[];
  /** Final ordered ids for book.questionIds — array position is the order. */
  questionIds: string[];
}

export interface PlanBatchSaveInput {
  incoming: IncomingQuestion[];
  /** Stored questions already owned by this book. */
  stored: Question[];
  bookId: string;
  customerId: string;
  newId: () => string;
  nowIso: () => string;
}

/**
 * Diff the full incoming ordered list against the book's stored questions:
 *   - item with an id matching a stored question for this book → update;
 *   - item with no id (or an unknown id) → create with a fresh id;
 *   - stored question whose id is absent from the incoming list → delete;
 *   - order = array position, captured into questionIds.
 *
 * Pure: the route turns this plan into one atomic sequence of store writes.
 */
export function planBatchSave(input: PlanBatchSaveInput): BatchSavePlan {
  const { incoming, stored, bookId, customerId, newId, nowIso } = input;
  const storedById = new Map(stored.map((q) => [q.id, q]));

  const create: Question[] = [];
  const update: QuestionUpdate[] = [];
  const questionIds: string[] = [];
  const survivingIds = new Set<string>();

  for (const item of incoming) {
    if (item.id !== undefined && storedById.has(item.id)) {
      update.push({ id: item.id, label: item.label, canonicalText: item.canonicalText });
      questionIds.push(item.id);
      survivingIds.add(item.id);
    } else {
      // No id, or an id we do not own → a new row; never honor a client-supplied unknown id.
      const id = newId();
      create.push({
        id,
        customerId,
        bookId,
        label: item.label,
        canonicalText: item.canonicalText,
        source: { kind: 'text', rawText: item.canonicalText },
        createdAt: nowIso(),
      });
      questionIds.push(id);
      survivingIds.add(id);
    }
  }

  const deleteIds = stored.filter((q) => !survivingIds.has(q.id)).map((q) => q.id);
  return { create, update, deleteIds, questionIds };
}
