import { describe, expect, it } from 'vitest';
import { FakeProvider } from './fake-provider.js';
import { LlmError } from './provider.js';

describe('FakeProvider', () => {
  it('complete returns the configured text', async () => {
    const p = new FakeProvider({ completeText: 'hello' });
    expect(await p.complete([{ role: 'user', text: 'hi' }])).toEqual('hello');
  });

  it('completeStructured returns the configured object', async () => {
    const obj = { critiqueText: 'good', recommendedGrade: 'partial' };
    const p = new FakeProvider({ structured: obj });
    expect(await p.completeStructured([{ role: 'user', text: 'hi' }], {})).toEqual(obj);
  });

  it('records the last conversation it was given', async () => {
    const p = new FakeProvider();
    await p.complete([
      { role: 'user', text: 'q1' },
      { role: 'assistant', text: 'a1' },
    ]);
    expect(p.lastConversation).toHaveLength(2);
    expect(p.lastConversation[1]).toMatchObject({ role: 'assistant', text: 'a1' });
  });

  it('failWith makes the next call reject', async () => {
    const p = new FakeProvider();
    p.failWith(new LlmError('boom'));
    await expect(p.complete([{ role: 'user', text: 'x' }])).rejects.toThrow('boom');
  });
});
