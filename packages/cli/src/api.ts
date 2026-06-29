import type { EnvName } from '@qb/auth-config';
import { authConfig } from './auth/config.js';
import { getAccessToken } from './auth/oidc.js';
import { loadTokens } from './auth/storage.js';

export interface Book {
  id: string;
  title: string;
  author?: string;
  [key: string]: unknown;
}

class NotLoggedInError extends Error {}

/** List the signed-in user's books (tenant-scoped by the bearer token's `sub`). */
export async function getBooks(): Promise<Book[]> {
  const tokens = loadTokens();
  const token = await getAccessToken();
  if (!tokens || !token) {
    throw new NotLoggedInError('not logged in — run `qb login` first');
  }
  const { apiBase } = authConfig(tokens.env as EnvName);
  const res = await fetch(`${apiBase}/api/books`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    throw new NotLoggedInError('session expired — run `qb login` again');
  }
  if (!res.ok) {
    throw new Error(`GET /api/books failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as Book[];
}
