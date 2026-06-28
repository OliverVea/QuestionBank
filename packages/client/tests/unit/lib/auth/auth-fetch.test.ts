import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { authFetch, onUnauthorized } from '@/lib/auth/auth-fetch';
import { resetDiscoveryCache } from '@/lib/auth/discovery';
import { clearTokens, saveTokens } from '@/lib/auth/storage';

beforeEach(() => {
  resetDiscoveryCache();
  clearTokens();
});
afterEach(() => vi.unstubAllGlobals());

describe('authFetch', () => {
  test('attaches the bearer token', async () => {
    saveTokens({ accessToken: 'AT', refreshToken: null, expiresAt: Date.now() + 60_000 });
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await authFetch('/api/books');

    const init = (fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit])[1];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer AT');
  });

  test('fires the onUnauthorized hook on a 401', async () => {
    saveTokens({ accessToken: 'AT', refreshToken: null, expiresAt: Date.now() + 60_000 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    const hook = vi.fn();
    onUnauthorized(hook);

    const res = await authFetch('/api/books');
    expect(res.status).toBe(401);
    expect(hook).toHaveBeenCalledOnce();
  });
});
