import Anthropic from '@anthropic-ai/sdk';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AnthropicApiProvider,
  mediaTypeForPath,
  parseExtractionResult,
} from './anthropic-api-provider.js';
import { extractionPrompt, extractionSchema } from './extraction-contract.js';
import { type ExtractedQuestion, LlmError } from './provider.js';

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

  it('strips extra keys, keeping only canonicalText and label', () => {
    const [q] = parseExtractionResult({
      questions: [{ canonicalText: 'q', label: '2.4', solution: 'leak' }],
    });
    expect(q).toEqual({ canonicalText: 'q', label: '2.4' });
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

describe('AnthropicApiProvider.extractQuestionsFromImage', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'qb-anthropic-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** A fake Anthropic client whose `messages.create` returns/throws as configured. */
  function fakeClient(create: () => Promise<unknown>): Anthropic {
    return { messages: { create } } as unknown as Anthropic;
  }

  /** Write a temp image file with the given extension and return its path. */
  async function tempImage(ext: string): Promise<string> {
    const path = join(dir, `page.${ext}`);
    await writeFile(path, Buffer.from('fake-image-bytes'));
    return path;
  }

  async function run(client: Anthropic, imagePath: string): Promise<ExtractedQuestion[]> {
    const provider = new AnthropicApiProvider(client);
    return provider.extractQuestionsFromImage({
      imagePath,
      prompt: extractionPrompt,
      schema: extractionSchema,
    });
  }

  it('returns the parsed questions on a successful response (happy path)', async () => {
    const fakeMessage = {
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            questions: [
              { canonicalText: '\\int x\\,dx', label: '2.4' },
              { canonicalText: 'Prove it.' },
            ],
          }),
        },
      ],
    };
    const client = fakeClient(async () => fakeMessage);
    const questions = await run(client, await tempImage('png'));
    expect(questions).toEqual([
      { canonicalText: '\\int x\\,dx', label: '2.4' },
      { canonicalText: 'Prove it.' },
    ]);
  });

  it('rejects with LlmError when the model refuses', async () => {
    const client = fakeClient(async () => ({ stop_reason: 'refusal', content: [] }));
    await expect(run(client, await tempImage('png'))).rejects.toThrow(LlmError);
  });

  it('rejects with LlmError when the response is truncated (max_tokens)', async () => {
    const client = fakeClient(async () => ({
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: 'partial' }],
    }));
    await expect(run(client, await tempImage('png'))).rejects.toThrow(LlmError);
  });

  it('rejects with LlmError when the text block is not valid JSON', async () => {
    const client = fakeClient(async () => ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'not json' }],
    }));
    await expect(run(client, await tempImage('png'))).rejects.toThrow(LlmError);
  });

  it('rejects with LlmError (wrapped) when the SDK call throws', async () => {
    const client = fakeClient(async () => {
      throw new Error('boom');
    });
    await expect(run(client, await tempImage('png'))).rejects.toThrow(LlmError);
  });

  it('rejects with LlmError for an unsupported image extension before calling the API', async () => {
    let called = false;
    const client = fakeClient(async () => {
      called = true;
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"questions":[]}' }] };
    });
    await expect(run(client, await tempImage('txt'))).rejects.toThrow(LlmError);
    expect(called).toBe(false);
  });
});
