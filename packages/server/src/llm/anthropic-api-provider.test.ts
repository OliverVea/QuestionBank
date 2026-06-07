import { describe, expect, it, vi } from 'vitest';
import { AnthropicApiProvider } from './anthropic-api-provider.js';
import { bufferImage } from './image-ref.js';
import { LlmError } from './provider.js';

/** Build a fake Anthropic client whose messages.create returns a canned message. */
function fakeClient(message: unknown) {
  return { messages: { create: vi.fn().mockResolvedValue(message) } } as never;
}

describe('AnthropicApiProvider', () => {
  it('complete returns the first text block', async () => {
    const provider = new AnthropicApiProvider(
      fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi there' }] }),
    );
    expect(await provider.complete([{ role: 'user', text: 'hi' }])).toEqual('hi there');
  });

  it('completeStructured parses the JSON text block', async () => {
    const provider = new AnthropicApiProvider(
      fakeClient({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"recommendedGrade":"correct"}' }],
      }),
    );
    const out = await provider.completeStructured<{ recommendedGrade: string }>(
      [{ role: 'user', text: 'grade' }],
      {},
    );
    expect(out).toEqual({ recommendedGrade: 'correct' });
  });

  it('serializes an image-bearing message into a base64 image block', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{}' }],
    });
    const provider = new AnthropicApiProvider({ messages: { create } } as never);
    await provider.completeStructured(
      [{ role: 'user', text: 'extract', images: [bufferImage(Buffer.from('img'), 'image/png')] }],
      {},
    );
    const sent = create.mock.calls[0]![0].messages[0].content;
    expect(sent[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png' } });
    expect(sent[1]).toMatchObject({ type: 'text', text: 'extract' });
  });

  it('throws LlmError on refusal', async () => {
    const provider = new AnthropicApiProvider(fakeClient({ stop_reason: 'refusal', content: [] }));
    await expect(provider.complete([{ role: 'user', text: 'x' }])).rejects.toThrow(LlmError);
  });

  it('throws LlmError on max_tokens truncation', async () => {
    const provider = new AnthropicApiProvider(
      fakeClient({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'partial' }] }),
    );
    await expect(provider.complete([{ role: 'user', text: 'x' }])).rejects.toThrow(LlmError);
  });

  it('wraps an SDK throw in LlmError', async () => {
    const create = vi.fn().mockRejectedValue(new Error('boom'));
    const provider = new AnthropicApiProvider({ messages: { create } } as never);
    await expect(provider.complete([{ role: 'user', text: 'x' }])).rejects.toThrow(LlmError);
  });

  it('completeStructured throws LlmError when the text block is not JSON', async () => {
    const provider = new AnthropicApiProvider(
      fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }),
    );
    await expect(provider.completeStructured([{ role: 'user', text: 'x' }], {})).rejects.toThrow(
      LlmError,
    );
  });
});
