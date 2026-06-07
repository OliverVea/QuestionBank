import { describe, expect, it } from 'vitest';
import { mediaTypeForPath, parseExtractionResult } from './anthropic-api-provider.js';
import { LlmError } from './provider.js';

describe('parseExtractionResult', () => {
  it('parses a valid structured-output object into ExtractedQuestion[]', () => {
    const questions = parseExtractionResult({
      questions: [
        { canonicalText: '\\int x\\,dx', label: '2.4' },
        { canonicalText: 'Prove it.' },
      ],
    });
    expect(questions).toEqual([
      { canonicalText: '\\int x\\,dx', label: '2.4' },
      { canonicalText: 'Prove it.' },
    ]);
  });

  it('throws LlmError when raw is not an object', () => {
    expect(() => parseExtractionResult('nope')).toThrow(LlmError);
    expect(() => parseExtractionResult(null)).toThrow(LlmError);
  });

  it('throws LlmError when questions is missing', () => {
    expect(() => parseExtractionResult({})).toThrow(LlmError);
  });

  it('throws LlmError when questions is not an array', () => {
    expect(() => parseExtractionResult({ questions: { canonicalText: 'q' } })).toThrow(LlmError);
  });

  it('throws LlmError when an item is not an object', () => {
    expect(() => parseExtractionResult({ questions: [42] })).toThrow(LlmError);
  });

  it('throws LlmError when an item lacks canonicalText', () => {
    expect(() => parseExtractionResult({ questions: [{ label: '2.4' }] })).toThrow(LlmError);
  });

  it('throws LlmError when canonicalText is blank', () => {
    expect(() => parseExtractionResult({ questions: [{ canonicalText: '   ' }] })).toThrow(LlmError);
  });

  it('omits label when absent rather than setting it undefined', () => {
    const [q] = parseExtractionResult({ questions: [{ canonicalText: 'q' }] });
    expect(q).toEqual({ canonicalText: 'q' });
    expect('label' in q!).toBe(false);
  });

  it('omits a present-but-empty label', () => {
    const [q] = parseExtractionResult({ questions: [{ canonicalText: 'q', label: '' }] });
    expect(q).toEqual({ canonicalText: 'q' });
    expect('label' in q!).toBe(false);
  });
});

describe('mediaTypeForPath', () => {
  it('maps known extensions to media types', () => {
    expect(mediaTypeForPath('/a/b/page.png')).toBe('image/png');
    expect(mediaTypeForPath('/a/b/page.jpg')).toBe('image/jpeg');
    expect(mediaTypeForPath('/a/b/page.JPEG')).toBe('image/jpeg');
    expect(mediaTypeForPath('/a/b/page.webp')).toBe('image/webp');
    expect(mediaTypeForPath('/a/b/page.gif')).toBe('image/gif');
  });

  it('throws LlmError on an unsupported extension', () => {
    expect(() => mediaTypeForPath('/a/b/notes.txt')).toThrow(LlmError);
  });

  it('throws LlmError when there is no extension', () => {
    expect(() => mediaTypeForPath('/a/b/page')).toThrow(LlmError);
  });
});
