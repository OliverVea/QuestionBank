import { afterEach, describe, expect, test, vi } from 'vitest';
import { discover, resetDiscoveryCache } from '@/lib/auth/discovery';

const DOC = {
  issuer: 'https://auth.test/application/o/questionbank/',
  authorization_endpoint: 'https://auth.test/application/o/authorize/',
  token_endpoint: 'https://auth.test/application/o/token/',
  jwks_uri: 'https://auth.test/application/o/questionbank/jwks/',
  end_session_endpoint: 'https://auth.test/application/o/questionbank/end-session/',
};

afterEach(() => {
  resetDiscoveryCache();
  vi.unstubAllGlobals();
});

describe('discover', () => {
  test('fetches and returns the discovery document', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(DOC), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const doc = await discover('https://auth.test/application/o/questionbank/');
    expect(doc.token_endpoint).toBe(DOC.token_endpoint);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test('caches per authority — second call does not refetch', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(DOC), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await discover('https://auth.test/application/o/questionbank/');
    await discover('https://auth.test/application/o/questionbank/');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
