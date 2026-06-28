import { getAccessToken } from './oidc.js';

type UnauthorizedHook = () => void;
let unauthorizedHook: UnauthorizedHook | null = null;

/**
 * Register a callback fired whenever an API response is 401. Seam for Project C
 * (redirect-to-relogin). No-op until something registers a hook.
 */
export function onUnauthorized(hook: UnauthorizedHook): void {
  unauthorizedHook = hook;
}

/** `fetch` wrapper that attaches the bearer token and surfaces 401s to the hook. */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) unauthorizedHook?.();
  return res;
}
