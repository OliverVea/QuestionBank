import { describe, expect, it } from 'vitest';
import { extractionPrompt, extractionSchema, extractionSchemaWithRelevance, relevanceInstruction } from '@/llm/extraction-contract.js';

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

  it('base schema does not include relevance', () => {
    expect(extractionSchema.items.properties).not.toHaveProperty('relevance');
  });
});

describe('relevanceInstruction', () => {
  it('includes the learning goal text in the instruction', () => {
    const instruction = relevanceInstruction('Master linear algebra');
    expect(instruction).toContain('Master linear algebra');
  });

  it('describes high, medium, and low levels', () => {
    const instruction = relevanceInstruction('any goal');
    expect(instruction).toContain('"high"');
    expect(instruction).toContain('"medium"');
    expect(instruction).toContain('"low"');
  });
});

describe('extractionSchemaWithRelevance', () => {
  it('requires relevance field as an enum', () => {
    const props = extractionSchemaWithRelevance.items.properties;
    expect(props.relevance.type).toEqual('string');
    expect(props.relevance.enum).toEqual(['high', 'medium', 'low']);
  });

  it('makes relevance required', () => {
    expect(extractionSchemaWithRelevance.items.required).toContain('relevance');
  });

  it('still requires canonicalText', () => {
    expect(extractionSchemaWithRelevance.items.required).toContain('canonicalText');
  });
});
