import { describe, expect, it } from 'vitest';
import { bufferImage } from '@/llm/image-ref.js';
import { extractQuestions, parseExtractionResult } from '@/llm/extract.js';
import { FakeProvider } from '@/llm/fake-provider.js';
import { LlmError } from '@/llm/provider.js';

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

  it('includes relevance when present and valid', () => {
    const out = parseExtractionResult({
      questions: [
        { canonicalText: 'a', label: '1', relevance: 'high' },
        { canonicalText: 'b', label: '2', relevance: 'medium' },
        { canonicalText: 'c', label: '3', relevance: 'low' },
      ],
    });
    expect(out).toEqual([
      { canonicalText: 'a', label: '1', relevance: 'high' },
      { canonicalText: 'b', label: '2', relevance: 'medium' },
      { canonicalText: 'c', label: '3', relevance: 'low' },
    ]);
  });

  it('drops invalid relevance values', () => {
    const out = parseExtractionResult({
      questions: [
        { canonicalText: 'a', relevance: 'critical' },
        { canonicalText: 'b', relevance: '' },
        { canonicalText: 'c', relevance: 42 },
      ],
    });
    expect(out).toEqual([
      { canonicalText: 'a' },
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

  it('strips extra keys, keeping only canonicalText, label, and relevance', () => {
    const [q] = parseExtractionResult({
      questions: [{ canonicalText: 'q', label: '2.4', relevance: 'high', solution: 'leak' }],
    });
    expect(q).toEqual({ canonicalText: 'q', label: '2.4', relevance: 'high' });
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

  it('includes relevance instruction in prompt when learningGoal is provided', async () => {
    const provider = new FakeProvider({
      structured: { questions: [{ canonicalText: 'x', relevance: 'high' }] },
    });
    const out = await extractQuestions(
      provider,
      bufferImage(Buffer.from('img'), 'image/png'),
      'Master integration by parts',
    );
    expect(out).toEqual([{ canonicalText: 'x', relevance: 'high' }]);
    // The prompt should mention the learning goal.
    const prompt = provider.lastConversation[0]?.text ?? '';
    expect(prompt).toContain('Master integration by parts');
    expect(prompt).toContain('relevance');
  });

  it('does not include relevance instruction when learningGoal is absent', async () => {
    const provider = new FakeProvider({ structured: { questions: [{ canonicalText: 'x' }] } });
    await extractQuestions(provider, bufferImage(Buffer.from('img'), 'image/png'));
    const prompt = provider.lastConversation[0]?.text ?? '';
    expect(prompt).not.toContain('relevance');
  });
});
