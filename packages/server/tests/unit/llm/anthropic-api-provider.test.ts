import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { AnthropicApiProvider } from '@/llm/anthropic-api-provider.js';
import { bufferImage } from '@/llm/image-ref.js';
import { LlmError } from '@/llm/provider.js';

/** Build a fake Anthropic client whose messages.create returns a canned message. */
function fakeClient(message: unknown) {
  return { messages: { create: vi.fn().mockResolvedValue(message) } } as never;
}

/** A real PNG of the given size, so sharp can resize it on send. */
function pngOf(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 150, b: 100 } } })
    .png()
    .toBuffer();
}

/** Decode the image block of the Nth recorded create() call: media type + sent dimensions. */
async function sentImage(create: ReturnType<typeof vi.fn>, callIdx = 0) {
  const block = create.mock.calls[callIdx]![0].messages[0].content[0];
  const meta = await sharp(Buffer.from(block.source.data, 'base64')).metadata();
  return { mediaType: block.source.media_type, longEdge: Math.max(meta.width ?? 0, meta.height ?? 0) };
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

  it('defaults max_tokens but lets a call site raise it', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
    });
    const provider = new AnthropicApiProvider({ messages: { create } } as never);

    await provider.complete([{ role: 'user', text: 'x' }]);
    expect(create.mock.calls[0]![0].max_tokens).toBe(8000);

    await provider.complete([{ role: 'user', text: 'x' }], { maxTokens: 16_000 });
    expect(create.mock.calls[1]![0].max_tokens).toBe(16_000);
  });

  it('throws LlmError on refusal', async () => {
    const provider = new AnthropicApiProvider(fakeClient({ stop_reason: 'refusal', content: [] }));
    await expect(provider.complete([{ role: 'user', text: 'x' }])).rejects.toThrow(LlmError);
  });

  it('throws LlmError on max_tokens truncation', async () => {
    const provider = new AnthropicApiProvider(
      fakeClient({
        stop_reason: 'max_tokens',
        content: [{ type: 'text', text: 'partial' }],
        usage: { output_tokens: 8000 },
      }),
    );
    await expect(provider.complete([{ role: 'user', text: 'x' }])).rejects.toThrow(LlmError);
  });

  it('wraps an SDK throw in LlmError', async () => {
    const create = vi.fn().mockRejectedValue(new Error('boom'));
    const provider = new AnthropicApiProvider({ messages: { create } } as never);
    await expect(provider.complete([{ role: 'user', text: 'x' }])).rejects.toThrow(LlmError);
    // No status, no error code ⇒ not retryable ⇒ a single attempt.
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('marks the tool strict only when the call site opts in', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'result', input: {} }],
    });
    const provider = new AnthropicApiProvider({ messages: { create } } as never);

    await provider.completeStructured([{ role: 'user', text: 'go' }], {});
    expect(create.mock.calls[0]![0].tools[0].strict).toBeUndefined();

    await provider.completeStructured([{ role: 'user', text: 'go' }], {}, { strict: true });
    expect(create.mock.calls[1]![0].tools[0].strict).toBe(true);
  });

  it('passes output_config.effort when a call site sets it', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'result', input: {} }],
    });
    const provider = new AnthropicApiProvider({ messages: { create } } as never);
    await provider.completeStructured([{ role: 'user', text: 'go' }], {}, { effort: 'medium' });
    expect(create.mock.calls[0]![0].output_config).toEqual({ effort: 'medium' });
  });

  it('omits output_config when no effort is set (Haiku rejects it)', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
    });
    const provider = new AnthropicApiProvider({ messages: { create } } as never);
    await provider.complete([{ role: 'user', text: 'x' }], { model: 'claude-haiku-4-5' });
    expect(create.mock.calls[0]![0].output_config).toBeUndefined();
  });

  it('disables the SDK retry so app-level retry owns it', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
    });
    const provider = new AnthropicApiProvider({ messages: { create } } as never);
    await provider.complete([{ role: 'user', text: 'x' }]);
    expect(create.mock.calls[0]![1]).toMatchObject({ maxRetries: 0 });
  });

  it('does not retry a non-retryable 400', async () => {
    const create = vi.fn().mockRejectedValue(Object.assign(new Error('bad'), { status: 400 }));
    const provider = new AnthropicApiProvider({ messages: { create } } as never);
    await expect(provider.complete([{ role: 'user', text: 'x' }])).rejects.toThrow(LlmError);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('caps a large image at 1568px JPEG for the default vision tier', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
    });
    const provider = new AnthropicApiProvider({ messages: { create } } as never);
    const big = await pngOf(3472, 4624);
    await provider.complete([{ role: 'user', text: 'x', images: [bufferImage(big, 'image/png')] }]);
    const img = await sentImage(create);
    expect(img.mediaType).toEqual('image/jpeg');
    expect(img.longEdge).toBeLessThanOrEqual(1568);
  });

  it('caps by model: Opus 4.8 keeps high-res that Sonnet 4.6 would shrink', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
    });
    const provider = new AnthropicApiProvider({ messages: { create } } as never);
    const mid = await pngOf(2200, 2200); // between the 1568 and 2576 caps
    const img = [{ role: 'user' as const, text: 'x', images: [bufferImage(mid, 'image/png')] }];

    await provider.complete(img, { model: 'claude-sonnet-4-6' });
    expect((await sentImage(create, 0)).longEdge).toEqual(1568); // shrunk to the default cap

    await provider.complete(img, { model: 'claude-opus-4-8' });
    expect((await sentImage(create, 1)).longEdge).toEqual(2200); // under 2576 → kept as-is
  });

  it('retries a transient 503 then succeeds', async () => {
    vi.useFakeTimers();
    try {
      const create = vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('overloaded'), { status: 503 }))
        .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] });
      const provider = new AnthropicApiProvider({ messages: { create } } as never);
      const p = provider.complete([{ role: 'user', text: 'x' }]);
      await vi.runAllTimersAsync(); // advance the backoff sleep
      expect(await p).toEqual('ok');
      expect(create).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
