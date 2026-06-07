import { describe, expect, it } from 'vitest';
import { bufferImage } from './image-ref.js';
import { extractQuestions, parseExtractionResult } from './extract.js';
import { FakeProvider } from './fake-provider.js';
import { LlmError } from './provider.js';

describe('parseExtractionResult', () => {
  it('keeps canonicalText, includes label when non-blank, drops blank label', () => {
    const out = parseExtractionResult({
      questions: [
        { canonicalText: 'a', label: '2.4' },
        { canonicalText: 'b', label: '  ' },
        { canonicalText: 'c' },
      ],
    });
    expect(out).toEqual([
      { canonicalText: 'a', label: '2.4' },
      { canonicalText: 'b' },
      { canonicalText: 'c' },
    ]);
  });

  it('throws on a non-array envelope', () => {
    expect(() => parseExtractionResult({ questions: 'nope' })).toThrow(LlmError);
  });

  it('throws on an item missing canonicalText', () => {
    expect(() => parseExtractionResult({ questions: [{ label: '1' }] })).toThrow(LlmError);
  });

  it('throws when raw is not an object, or questions is missing', () => {
    expect(() => parseExtractionResult('nope')).toThrow(LlmError);
    expect(() => parseExtractionResult(null)).toThrow(LlmError);
    expect(() => parseExtractionResult({})).toThrow(LlmError);
  });

  it('throws when an item is not an object, or canonicalText is blank', () => {
    expect(() => parseExtractionResult({ questions: [42] })).toThrow(LlmError);
    expect(() => parseExtractionResult({ questions: [{ canonicalText: '   ' }] })).toThrow(LlmError);
  });

  it('strips extra keys, keeping only canonicalText and label', () => {
    const [q] = parseExtractionResult({
      questions: [{ canonicalText: 'q', label: '2.4', solution: 'leak' }],
    });
    expect(q).toEqual({ canonicalText: 'q', label: '2.4' });
  });
});

describe('extractQuestions', () => {
  it('passes a single image-bearing user message and returns parsed questions', async () => {
    const provider = new FakeProvider({ structured: { questions: [{ canonicalText: 'x' }] } });
    const out = await extractQuestions(provider, bufferImage(Buffer.from('img'), 'image/png'));
    expect(out).toEqual([{ canonicalText: 'x' }]);
    expect(provider.lastConversation).toHaveLength(1);
    expect(provider.lastConversation[0]?.images).toHaveLength(1);
  });
});
