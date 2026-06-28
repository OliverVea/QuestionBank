import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWTPayload } from 'jose';
import { createVerifier } from './verify-bearer.js';

const ISS = 'https://auth.example.test/application/o/questionbank/';
const AUD = 'questionbank';

let signToken: (claims: JWTPayload, opts?: { iss?: string; aud?: string; exp?: string; nbf?: string }) => Promise<string>;
let badSigToken: (claims: JWTPayload) => Promise<string>;
let verify: ReturnType<typeof createVerifier>;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  const jwks = createLocalJWKSet({ keys: [jwk] });

  // A second, unrelated key — its tokens must fail signature verification.
  const other = await generateKeyPair('RS256');

  signToken = (claims, opts = {}) => {
    let builder = new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(opts.iss ?? ISS)
      .setAudience(opts.aud ?? AUD)
      .setExpirationTime(opts.exp ?? '2h');
    if (opts.nbf) builder = builder.setNotBefore(opts.nbf);
    return builder.sign(privateKey);
  };

  badSigToken = (claims) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(ISS)
      .setAudience(AUD)
      .setExpirationTime('2h')
      .sign(other.privateKey);

  verify = createVerifier({ authority: ISS, issuer: ISS, audience: AUD, jwks });
});

describe('verifyBearer', () => {
  it('accepts a valid token and resolves sub -> customerId', async () => {
    const token = await signToken({ sub: 'cust-123' });
    const result = await verify(token);
    expect(result.customerId).toBe('cust-123');
    expect(result.claims.sub).toBe('cust-123');
  });

  it('rejects an expired token', async () => {
    const token = await signToken({ sub: 'cust-123' }, { exp: '-1h' });
    await expect(verify(token)).rejects.toThrow();
  });

  it('rejects a wrong issuer', async () => {
    const token = await signToken({ sub: 'cust-123' }, { iss: 'https://evil.test/' });
    await expect(verify(token)).rejects.toThrow();
  });

  it('rejects a wrong audience', async () => {
    const token = await signToken({ sub: 'cust-123' }, { aud: 'someone-else' });
    await expect(verify(token)).rejects.toThrow();
  });

  it('rejects a bad signature', async () => {
    const token = await badSigToken({ sub: 'cust-123' });
    await expect(verify(token)).rejects.toThrow();
  });

  it('rejects a token missing the sub claim', async () => {
    const token = await signToken({ name: 'no-sub' });
    await expect(verify(token)).rejects.toThrow(/sub/);
  });

  it('rejects an empty token string', async () => {
    await expect(verify('')).rejects.toThrow();
  });

  it('rejects a whitespace-only sub claim', async () => {
    const token = await signToken({ sub: '   ' });
    await expect(verify(token)).rejects.toThrow(/sub/);
  });

  it('rejects a token whose nbf is in the future', async () => {
    const token = await signToken({ sub: 'cust-123' }, { nbf: '2h' });
    await expect(verify(token)).rejects.toThrow();
  });
});

describe('createVerifier (discovery path)', () => {
  const AUTHORITY = 'https://auth.discovery.test/application/o/questionbank/';

  it('does not cache a transient discovery failure — a later call retries', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const v = createVerifier({ authority: AUTHORITY, audience: AUD });
    await expect(v('any')).rejects.toThrow();
    await expect(v('any')).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(2); // proves `ready` was reset, not cached
    vi.unstubAllGlobals();
  });

  it('rejects when the discovery document omits issuer (no silent iss bypass)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ jwks_uri: 'https://x.test/jwks/' }), { status: 200 })),
    );
    const v = createVerifier({ authority: AUTHORITY, audience: AUD });
    await expect(v('any')).rejects.toThrow(/issuer/);
    vi.unstubAllGlobals();
  });
});
