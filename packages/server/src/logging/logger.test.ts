import { describe, expect, it } from 'vitest';
import { errorCode } from './logger.js';

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
