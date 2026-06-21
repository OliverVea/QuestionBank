import { LlmError } from './provider.js';
import type { Relevance } from '../domain/types.js';

const VALID_RELEVANCE = new Set<Relevance>(['high', 'medium', 'low']);

/** A resolved extraction delta the model emits for each problem it found. */
export interface Delta {
  kind: 'add' | 'edit' | 'skip';
  /** Present for add/edit — the derived dotted path. */
  path?: string;
  /** The (possibly corrected) transcription. */
  canonicalText: string;
  /** Present for edit/skip — the existing problem's UUID. */
  targetId?: string;
  /** Relevance to the book's learning goal (only when a goal was given; never on skip). */
  relevance?: Relevance;
  /** Figure caption labels this problem cites (add/edit only; v1 uses add's). Defaults to []. */
  figureRefs?: string[];
}

/** Read the figure-reference labels off a raw item — strings only, blanks dropped. */
function readFigureRefs(raw: Record<string, unknown>): string[] {
  return Array.isArray(raw.figureRefs)
    ? raw.figureRefs.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    : [];
}

/** Read a valid relevance off a raw item, or undefined (invalid/absent values are dropped). */
function readRelevance(raw: Record<string, unknown>): Relevance | undefined {
  const r = raw.relevance;
  return typeof r === 'string' && VALID_RELEVANCE.has(r as Relevance) ? (r as Relevance) : undefined;
}

/** Problems on one page the model could not place — the user supplies the prefix. */
export interface NeedsSection {
  /** 0-based index into the uploaded images. */
  pageIndex: number;
  problems: Array<{ localLabel: string; canonicalText: string }>;
}

export interface ExtractionEnvelope {
  resolved: Delta[];
  needsSection: NeedsSection[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

/** Validate one resolved item, enforcing the cross-field rules the JSON schema can't. */
function validateDelta(raw: unknown, existingIds: Set<string>): Delta {
  if (!isObject(raw)) throw new LlmError('resolved item is not an object');
  const { kind, path, canonicalText, targetId } = raw;
  if (kind !== 'add' && kind !== 'edit' && kind !== 'skip') {
    throw new LlmError(`resolved item has invalid kind: ${String(kind)}`);
  }
  if (!nonEmptyString(canonicalText)) {
    throw new LlmError('resolved item missing canonicalText');
  }
  const relevance = readRelevance(raw);
  const figureRefs = readFigureRefs(raw);
  if (kind === 'add') {
    if (!nonEmptyString(path)) throw new LlmError('add delta requires a path');
    if (targetId !== undefined) throw new LlmError('add delta must not carry a targetId');
    return { kind, path, canonicalText, ...(relevance ? { relevance } : {}), figureRefs };
  }
  if (kind === 'edit') {
    if (!nonEmptyString(path)) throw new LlmError('edit delta requires a path');
    if (!nonEmptyString(targetId)) throw new LlmError('edit delta requires a targetId');
    if (!existingIds.has(targetId)) throw new LlmError(`edit targetId is not an existing problem: ${targetId}`);
    return { kind, path, canonicalText, targetId, ...(relevance ? { relevance } : {}), figureRefs };
  }
  // skip — never carries relevance (it is informational only, never committed).
  if (!nonEmptyString(targetId)) throw new LlmError('skip delta requires a targetId');
  if (!existingIds.has(targetId)) throw new LlmError(`skip targetId is not an existing problem: ${targetId}`);
  return { kind, canonicalText, targetId };
}

/** Validate one needsSection page entry. */
function validateNeedsSection(raw: unknown, pageCount: number): NeedsSection {
  if (!isObject(raw)) throw new LlmError('needsSection item is not an object');
  const { pageIndex, problems } = raw;
  if (typeof pageIndex !== 'number' || !Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) {
    throw new LlmError(`needsSection pageIndex out of range: ${String(pageIndex)}`);
  }
  if (!Array.isArray(problems)) throw new LlmError('needsSection problems must be an array');
  const validated = problems.map((p) => {
    if (!isObject(p) || !nonEmptyString(p.localLabel) || !nonEmptyString(p.canonicalText)) {
      throw new LlmError('needsSection problem missing localLabel/canonicalText');
    }
    return { localLabel: p.localLabel, canonicalText: p.canonicalText };
  });
  return { pageIndex, problems: validated };
}

/**
 * Validate the raw model output into a typed ExtractionEnvelope, enforcing the
 * cross-field rules the JSON schema can't express. Throws LlmError (→ 502) on any
 * violation. `existingIds` are the book's current problem UUIDs; `pageCount` is the
 * number of uploaded images.
 */
export function validateExtractionEnvelope(
  raw: unknown,
  existingIds: string[],
  pageCount: number,
): ExtractionEnvelope {
  if (!isObject(raw)) throw new LlmError('extraction result is not an object');
  const { resolved, needsSection } = raw;
  if (!Array.isArray(resolved)) throw new LlmError('extraction result has no resolved array');
  if (!Array.isArray(needsSection)) throw new LlmError('extraction result has no needsSection array');
  const ids = new Set(existingIds);
  return {
    resolved: resolved.map((d) => validateDelta(d, ids)),
    needsSection: needsSection.map((n) => validateNeedsSection(n, pageCount)),
  };
}
