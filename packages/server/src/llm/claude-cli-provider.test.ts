import { describe, expect, it } from 'vitest';
import { parseCliEnvelope } from './claude-cli-provider.js';
import { LlmError } from './provider.js';

const validEnvelope = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: JSON.stringify([
    { canonicalText: '\\int x\\,dx', label: '2.4' },
    { canonicalText: 'Prove that the sum is finite.' },
  ]),
});

describe('parseCliEnvelope', () => {
  it('parses a valid envelope into ExtractedQuestion[]', () => {
    const questions = parseCliEnvelope(validEnvelope);
    expect(questions).toEqual([
      { canonicalText: '\\int x\\,dx', label: '2.4' },
      { canonicalText: 'Prove that the sum is finite.' },
    ]);
  });

  it('throws LlmError when the envelope is not JSON', () => {
    expect(() => parseCliEnvelope('not json at all')).toThrow(LlmError);
  });

  it('throws LlmError when the envelope reports an error', () => {
    const errEnvelope = JSON.stringify({ type: 'result', is_error: true, result: 'boom' });
    expect(() => parseCliEnvelope(errEnvelope)).toThrow(LlmError);
  });

  it('throws LlmError when result is not a JSON array', () => {
    const bad = JSON.stringify({ type: 'result', is_error: false, result: '{"not":"an array"}' });
    expect(() => parseCliEnvelope(bad)).toThrow(LlmError);
  });

  it('throws LlmError when an item is missing canonicalText', () => {
    const bad = JSON.stringify({
      type: 'result',
      is_error: false,
      result: JSON.stringify([{ label: 'no text here' }]),
    });
    expect(() => parseCliEnvelope(bad)).toThrow(LlmError);
  });

  it('omits label when absent rather than setting it undefined', () => {
    const env = JSON.stringify({
      type: 'result',
      is_error: false,
      result: JSON.stringify([{ canonicalText: 'q' }]),
    });
    const [q] = parseCliEnvelope(env);
    expect(q).toEqual({ canonicalText: 'q' });
    expect('label' in q!).toBe(false);
  });

  it('throws LlmError when result is a JSON array containing a non-object item', () => {
    const bad = JSON.stringify({
      type: 'result',
      is_error: false,
      result: JSON.stringify([42]),
    });
    expect(() => parseCliEnvelope(bad)).toThrow(LlmError);
  });

  it('throws LlmError when canonicalText is present but blank', () => {
    const bad = JSON.stringify({
      type: 'result',
      is_error: false,
      result: JSON.stringify([{ canonicalText: '   ' }]),
    });
    expect(() => parseCliEnvelope(bad)).toThrow(LlmError);
  });

  it('omits a present-but-empty label', () => {
    const env = JSON.stringify({
      type: 'result',
      is_error: false,
      result: JSON.stringify([{ canonicalText: 'q', label: '' }]),
    });
    const [q] = parseCliEnvelope(env);
    expect(q).toEqual({ canonicalText: 'q' });
    expect('label' in q!).toBe(false);
  });

  it('throws LlmError when envelope.result is not a string (already-parsed array)', () => {
    const bad = JSON.stringify({
      type: 'result',
      is_error: false,
      result: [{ canonicalText: 'q' }],
    });
    expect(() => parseCliEnvelope(bad)).toThrow(LlmError);
  });
});
