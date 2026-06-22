import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorCode, log } from './logger.js';

describe('errorCode', () => {
  it('returns undefined when no code is present anywhere in the chain', () => {
    expect(errorCode(new Error('plain'))).toBeUndefined();
    expect(errorCode('a string')).toBeUndefined();
    expect(errorCode(undefined)).toBeUndefined();
  });

  it('reads a code off the top-level error', () => {
    const err = Object.assign(new Error('boom'), { code: 'ECONNREFUSED' });
    expect(errorCode(err)).toEqual('ECONNREFUSED');
  });

  it('walks the cause chain to find a buried code', () => {
    // Mirrors the real Anthropic SDK shape on a transport failure:
    // APIConnectionError("Connection error.") → TypeError("fetch failed") → { code: ETIMEDOUT }.
    const root = Object.assign(new Error('fetch failed'), {
      cause: { code: 'ETIMEDOUT' },
    });
    const wrapper = new Error('Connection error.', { cause: root });
    expect(errorCode(wrapper)).toEqual('ETIMEDOUT');
  });

  it('does not loop forever on a self-referential cause', () => {
    const a = new Error('a');
    (a as { cause?: unknown }).cause = a;
    expect(errorCode(a)).toBeUndefined();
  });
});

describe('QB_LOG_FORMAT=json', () => {
  const prevFormat = process.env.QB_LOG_FORMAT;
  const prevLevel = process.env.QB_LOG_LEVEL;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.QB_LOG_FORMAT = 'json';
    process.env.QB_LOG_LEVEL = 'debug'; // ensure nothing is gated out
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    if (prevFormat === undefined) delete process.env.QB_LOG_FORMAT;
    else process.env.QB_LOG_FORMAT = prevFormat;
    if (prevLevel === undefined) delete process.env.QB_LOG_LEVEL;
    else process.env.QB_LOG_LEVEL = prevLevel;
  });

  it('emits one parseable JSON object per line with ts, level, msg and context fields', () => {
    log.info('request handled', { route: '/grade', ms: 42 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('request handled');
    expect(parsed.route).toBe('/grade');
    expect(parsed.ms).toBe(42);
    expect(typeof parsed.ts).toBe('string');
    expect(Number.isNaN(Date.parse(parsed.ts))).toBe(false);
  });

  it('contains no ANSI escape codes in json mode', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log.warn('careful', { n: 1 });
    const line = warnSpy.mock.calls[0][0] as string;
    expect(line).not.toMatch(/\x1b\[/);
    expect(JSON.parse(line).level).toBe('warn');
    warnSpy.mockRestore();
  });

  it('routes error level to console.error in json mode', () => {
    log.error('boom', { code: 'E_X' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = errorSpy.mock.calls[0][0] as string;
    expect(line).not.toMatch(/\x1b\[/); // no ANSI
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('error');
    expect(parsed.code).toBe('E_X');
  });

  it('does not let context keys override the reserved ts/level/msg fields', () => {
    log.info('real message', { msg: 'spoofed', level: 'debug', ts: 'nope', keep: 'yes' });
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.msg).toBe('real message');
    expect(parsed.level).toBe('info');
    expect(parsed.ts).not.toBe('nope');
    expect(parsed.keep).toBe('yes');
  });

  it('skips undefined context values', () => {
    log.info('m', { a: undefined, b: 2 });
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect('a' in parsed).toBe(false);
    expect(parsed.b).toBe(2);
  });
});
