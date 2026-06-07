import { describe, expect, it } from 'vitest';
import { extractionPrompt, extractionSchema } from './extraction-contract.js';

describe('extractionPrompt', () => {
  it('still forbids solving/answering/hinting', () => {
    expect(extractionPrompt).toMatch(/do not solve/i);
  });

  it('instructs the agent to always produce a label', () => {
    expect(extractionPrompt).toMatch(/always/i);
    expect(extractionPrompt).toMatch(/label/i);
  });

  it('describes a position-based fallback when no real label exists', () => {
    expect(extractionPrompt).toMatch(/#1|ordinal|fallback/i);
  });

  it('schema keeps canonicalText required and label a string', () => {
    expect(extractionSchema.items.required).toContain('canonicalText');
    expect(extractionSchema.items.properties.label.type).toEqual('string');
  });
});
