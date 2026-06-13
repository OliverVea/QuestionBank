import { describe, expect, it } from 'vitest';
import { LlmError } from './provider.js';
import { validateExtractionEnvelope } from './extraction-delta.js';

const EXISTING = ['q1', 'q2'];

describe('validateExtractionEnvelope', () => {
  it('accepts a well-formed add/edit/skip envelope and returns it typed', () => {
    const raw = {
      resolved: [
        { kind: 'add', path: '1.A.3', canonicalText: 'new one' },
        { kind: 'edit', path: '1.A.1', canonicalText: 'fixed', targetId: 'q1' },
        { kind: 'skip', canonicalText: 'unchanged', targetId: 'q2' },
      ],
      needsSection: [
        { pageIndex: 1, problems: [{ localLabel: '4', canonicalText: 'bare four' }] },
      ],
    };
    const env = validateExtractionEnvelope(raw, EXISTING, 2);
    expect(env.resolved).toHaveLength(3);
    expect(env.resolved[0]).toEqual({ kind: 'add', path: '1.A.3', canonicalText: 'new one' });
    expect(env.needsSection[0].pageIndex).toEqual(1);
  });

  it('carries a valid relevance through on add/edit and ignores it on skip', () => {
    const raw = {
      resolved: [
        { kind: 'add', path: '1.A.3', canonicalText: 'new one', relevance: 'high' },
        { kind: 'edit', path: '1.A.1', canonicalText: 'fixed', targetId: 'q1', relevance: 'medium' },
        { kind: 'skip', canonicalText: 'unchanged', targetId: 'q2', relevance: 'low' },
      ],
      needsSection: [],
    };
    const env = validateExtractionEnvelope(raw, EXISTING, 1);
    expect(env.resolved[0].relevance).toEqual('high');
    expect(env.resolved[1].relevance).toEqual('medium');
    // skip carries no relevance into the result (it is never committed).
    expect(env.resolved[2].relevance).toBeUndefined();
  });

  it('drops an invalid relevance value rather than throwing (add stays valid)', () => {
    const raw = { resolved: [{ kind: 'add', path: '1.A.3', canonicalText: 'x', relevance: 'bogus' }], needsSection: [] };
    const env = validateExtractionEnvelope(raw, EXISTING, 1);
    expect(env.resolved[0].relevance).toBeUndefined();
  });

  it('rejects an edit with no targetId (502 via LlmError)', () => {
    const raw = { resolved: [{ kind: 'edit', path: '1.A.1', canonicalText: 'x' }], needsSection: [] };
    expect(() => validateExtractionEnvelope(raw, EXISTING, 1)).toThrow(LlmError);
  });

  it('rejects an add carrying a targetId', () => {
    const raw = { resolved: [{ kind: 'add', path: '1.A.1', canonicalText: 'x', targetId: 'q1' }], needsSection: [] };
    expect(() => validateExtractionEnvelope(raw, EXISTING, 1)).toThrow(LlmError);
  });

  it('rejects an add with no path', () => {
    const raw = { resolved: [{ kind: 'add', canonicalText: 'x' }], needsSection: [] };
    expect(() => validateExtractionEnvelope(raw, EXISTING, 1)).toThrow(LlmError);
  });

  it('rejects a skip whose targetId is not an existing problem', () => {
    const raw = { resolved: [{ kind: 'skip', canonicalText: 'x', targetId: 'ghost' }], needsSection: [] };
    expect(() => validateExtractionEnvelope(raw, EXISTING, 1)).toThrow(LlmError);
  });

  it('rejects a needsSection pageIndex out of range', () => {
    const raw = { resolved: [], needsSection: [{ pageIndex: 5, problems: [{ localLabel: '1', canonicalText: 'x' }] }] };
    expect(() => validateExtractionEnvelope(raw, EXISTING, 2)).toThrow(LlmError);
  });

  it('rejects a non-object / missing-arrays envelope', () => {
    expect(() => validateExtractionEnvelope(null, EXISTING, 1)).toThrow(LlmError);
    expect(() => validateExtractionEnvelope({ resolved: [] }, EXISTING, 1)).toThrow(LlmError);
  });
});
