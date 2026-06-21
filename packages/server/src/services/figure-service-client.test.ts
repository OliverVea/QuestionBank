import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FigureServiceError,
  figureServiceClient,
  figureServiceFromEnv,
} from './figure-service-client.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('figureServiceFromEnv', () => {
  it('returns null when FIGURE_SERVICE_URL is unset', () => {
    expect(figureServiceFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(figureServiceFromEnv({ FIGURE_SERVICE_URL: '  ' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('returns a client when the URL is set', () => {
    const client = figureServiceFromEnv({
      FIGURE_SERVICE_URL: 'http://figures',
    } as NodeJS.ProcessEnv);
    expect(client).not.toBeNull();
  });
});

describe('figureServiceClient.process', () => {
  it('POSTs multipart to /v1/process with the API key and maps snake_case → camelCase', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          rectified: { png_base64: 'AAAA', width: 100, height: 200 },
          figures: [{ id: 0, cls: 'figure', score: 0.9, box: [1, 2, 3, 4], corners: [] }],
        }),
        { status: 200 },
      ),
    );

    const client = figureServiceClient('http://figures/', 'secret');
    const result = await client.process(Buffer.from('img'), 'image/png');

    expect(result.rectified).toEqual({ pngBase64: 'AAAA', width: 100, height: 200 });
    expect(result.figures).toEqual([{ id: 0, box: [1, 2, 3, 4], score: 0.9 }]);

    const [calledUrl, init] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toEqual('http://figures/v1/process');
    expect((init?.headers as Record<string, string>)['X-API-Key']).toEqual('secret');
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it('omits the API key header when none is configured', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ rectified: { png_base64: 'A', width: 1, height: 1 }, figures: [] }),
        { status: 200 },
      ),
    );
    const client = figureServiceClient('http://figures');
    await client.process(Buffer.from('img'), 'image/jpeg');
    const init = fetchMock.mock.calls[0]![1];
    expect((init?.headers as Record<string, string>)['X-API-Key']).toBeUndefined();
  });

  it('throws FigureServiceError on a non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const client = figureServiceClient('http://figures');
    await expect(client.process(Buffer.from('x'), 'image/png')).rejects.toBeInstanceOf(
      FigureServiceError,
    );
  });

  it('throws FigureServiceError when the response is malformed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ nope: true }), { status: 200 }),
    );
    const client = figureServiceClient('http://figures');
    await expect(client.process(Buffer.from('x'), 'image/png')).rejects.toBeInstanceOf(
      FigureServiceError,
    );
  });
});
