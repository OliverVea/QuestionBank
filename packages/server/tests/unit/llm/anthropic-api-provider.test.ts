import { describe, expect, it, vi } from 'vitest';
import { AnthropicApiProvider } from '@/llm/anthropic-api-provider.js';
import { bufferImage } from '@/llm/image-ref.js';
import { LlmError } from '@/llm/provider.js';

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

  // Guards the production-critical contract: structured output MUST force a single
  // tool call matching the schema (sending unknown top-level fields 502s the request),
  // and the result is read from the returned tool_use block — not parsed from prose.
  it('completeStructured forces tool use and returns the tool_use input', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'result', input: { issues: [] } }],
    });
    const provider = new AnthropicApiProvider({ messages: { create } } as never);
    const schema = { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] };
    const out = await provider.completeStructured([{ role: 'user', text: 'go' }], schema);

    const sent = create.mock.calls[0]![0];
    expect(sent.tools).toEqual([expect.objectContaining({ name: 'result', input_schema: schema })]);
    expect(sent.tool_choice).toEqual({ type: 'tool', name: 'result' });
    expect(out).toEqual({ issues: [] });
  });

  it('serializes an image-bearing message into a base64 image block', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'result', input: {} }],
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

});
