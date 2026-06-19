// packages/client/tests/unit/pages/grade/grade-api.test.ts
import { describe, test, expect, vi, afterEach } from 'vitest';
import * as api from '@/pages/grade/grade-api';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
afterEach(() => vi.unstubAllGlobals());

const png = () => new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });

describe('grade-api', () => {
  test('transcribe posts multipart and returns the string', async () => {
    const fn = mockFetch(200, { transcription: 'x = 4' });
    const out = await api.transcribe('q1', [png()], 'note');
    expect(out).toBe('x = 4');
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe('/api/questions/q1/transcribe');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('notes')).toBe('note');
  });

  test('retranscribe posts the current transcription + correction note', async () => {
    const fn = mockFetch(200, { transcription: 'x = 1' });
    const out = await api.retranscribe('q1', [png()], 'x = 7', 'that 7 is a 1');
    expect(out).toBe('x = 1');
    const body = fn.mock.calls[0]![1].body as FormData;
    expect(fn.mock.calls[0]![0]).toBe('/api/questions/q1/transcribe/retry');
    expect(body.get('currentTranscription')).toBe('x = 7');
    expect(body.get('correctionNote')).toBe('that 7 is a 1');
  });

  test('grade posts the conversation as JSON and returns the payload', async () => {
    const payload = { reasoning: 'r', issues: [], recommendedGrade: 'correct' };
    const fn = mockFetch(200, payload);
    const out = await api.grade('q1', [{ role: 'user', text: 'x = 4' }]);
    expect(out).toEqual(payload);
    const init = fn.mock.calls[0]![1];
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ conversation: [{ role: 'user', text: 'x = 4' }] });
  });

  test('a non-ok response throws', async () => {
    mockFetch(502, {});
    await expect(api.grade('q1', [{ role: 'user', text: 'x' }])).rejects.toThrow();
  });

  test('saveAttempt and skip post JSON / no body', async () => {
    const fn = mockFetch(201, {});
    await api.saveAttempt('q1', { answer: 'a', recommendedGrade: 'correct', rating: 'correct', issues: [] });
    expect(fn.mock.calls[0]![0]).toBe('/api/questions/q1/attempts');
    await api.skip('q1');
    expect(fn.mock.calls[1]![0]).toBe('/api/skip/q1');
  });
});
