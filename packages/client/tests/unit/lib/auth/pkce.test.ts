import { describe, expect, test } from 'vitest';
import { challengeFromVerifier, generateState, generateVerifier } from '@/lib/auth/pkce';

describe('pkce', () => {
  test('challengeFromVerifier matches the RFC 7636 test vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = await challengeFromVerifier(verifier);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  test('generateVerifier returns a url-safe string of usable length', () => {
    const v = generateVerifier();
    expect(v).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(v.length).toBeGreaterThanOrEqual(43);
  });

  test('generateState returns a url-safe random string', () => {
    expect(generateState()).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(generateState()).not.toBe(generateState());
  });
});
