import { describe, expect, it } from 'vitest';
import { extractionPrompt, extractionSchema } from './extraction-contract.js';
import { FakeProvider } from './fake-provider.js';
import { LlmError } from './provider.js';

const req = { imagePath: '/tmp/x.png', prompt: extractionPrompt, schema: extractionSchema };

describe('FakeProvider', () => {
  it('returns its configured questions', async () => {
    const provider = new FakeProvider([
      { canonicalText: '\\int x\\,dx', label: '2.4' },
      { canonicalText: 'Prove that 1 = 1.' },
    ]);
    const result = await provider.extractQuestionsFromImage(req);
    expect(result).toEqual([
      { canonicalText: '\\int x\\,dx', label: '2.4' },
      { canonicalText: 'Prove that 1 = 1.' },
    ]);
  });

  it('defaults to a single deterministic question', async () => {
    const provider = new FakeProvider();
    const result = await provider.extractQuestionsFromImage(req);
    expect(result).toHaveLength(1);
    expect(result[0]?.canonicalText).toBeTruthy();
  });

  it('throws when configured to fail', async () => {
    const provider = new FakeProvider();
    provider.failWith(new LlmError('boom'));
    await expect(provider.extractQuestionsFromImage(req)).rejects.toBeInstanceOf(LlmError);
  });
});
