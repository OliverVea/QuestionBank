import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildAuthorizeUrl, exchangeCode, getAccessToken, refresh } from '@/lib/auth/oidc';
import { resetDiscoveryCache } from '@/lib/auth/discovery';
import { clearTokens, loadTokens, saveTokens } from '@/lib/auth/storage';

const DOC = {
  issuer: 'https://auth.test/application/o/questionbank/',
  authorization_endpoint: 'https://auth.test/application/o/authorize/',
  token_endpoint: 'https://auth.test/application/o/token/',
  jwks_uri: 'https://auth.test/jwks/',
};

beforeEach(() => {
  resetDiscoveryCache();
  clearTokens();
});
afterEach(() => vi.unstubAllGlobals());

describe('buildAuthorizeUrl', () => {
  test('includes PKCE + required params', () => {
    const url = new URL(
      buildAuthorizeUrl(DOC.authorization_endpoint, {
        clientId: 'questionbank',
        redirectUri: 'https://app.test/auth/callback',
        scopes: 'openid profile email',
        state: 'st',
        challenge: 'ch',
      }),
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('questionbank');
    expect(url.searchParams.get('code_challenge')).toBe('ch');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/auth/callback');
  });
});

describe('exchangeCode', () => {
  test('POSTs the code + verifier and stores tokens', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = typeof input === 'string' ? input : input.toString();
      if (u.endsWith('openid-configuration')) return new Response(JSON.stringify(DOC), { status: 200 });
      return new Response(
        JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 300 }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await exchangeCode('https://auth.test/application/o/questionbank/', {
      code: 'c', verifier: 'v', clientId: 'questionbank', redirectUri: 'https://app.test/auth/callback',
    });

    const tokens = loadTokens();
    expect(tokens?.accessToken).toBe('AT');
    expect(tokens?.refreshToken).toBe('RT');
    expect(tokens?.expiresAt).toBeGreaterThan(0);

    // Verify the token request actually carried the PKCE verifier + correct grant (not just that tokens were stored).
    const allCalls = fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit][];
    const tokenCall = allCalls.find(
      ([u]) => !(typeof u === 'string' ? u : (u as URL).toString()).endsWith('openid-configuration'),
    );
    expect(tokenCall).toBeDefined();
    const [tokenUrl, init] = tokenCall!;
    expect((typeof tokenUrl === 'string' ? tokenUrl : (tokenUrl as URL).toString())).toBe(DOC.token_endpoint);
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/x-www-form-urlencoded');
    const sent = init.body as URLSearchParams;
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('code')).toBe('c');
    expect(sent.get('code_verifier')).toBe('v');
    expect(sent.get('redirect_uri')).toBe('https://app.test/auth/callback');
    expect(sent.get('client_id')).toBe('questionbank');
  });
});

describe('getAccessToken', () => {
  test('returns a stored unexpired token without refreshing', async () => {
    saveTokens({ accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 60_000 });
    expect(await getAccessToken('https://auth.test/application/o/questionbank/', 'questionbank')).toBe('AT');
  });

  test('returns null when there is no token', async () => {
    expect(await getAccessToken('https://auth.test/application/o/questionbank/', 'questionbank')).toBeNull();
  });
});

describe('refresh', () => {
  test('exchanges the refresh token and updates storage', async () => {
    saveTokens({ accessToken: 'old', refreshToken: 'RT', expiresAt: Date.now() - 1 });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = typeof input === 'string' ? input : input.toString();
      if (u.endsWith('openid-configuration')) return new Response(JSON.stringify(DOC), { status: 200 });
      return new Response(
        JSON.stringify({ access_token: 'new', refresh_token: 'RT2', expires_in: 300 }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const token = await refresh('https://auth.test/application/o/questionbank/', 'questionbank');
    expect(token).toBe('new');
    expect(loadTokens()?.refreshToken).toBe('RT2');
  });
});
