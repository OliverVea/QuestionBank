import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Token cache location. Mirrors the `pl` CLI's `~/.pl`. Override with QB_TOKEN_FILE (tests). */
const STORE_PATH = process.env.QB_TOKEN_FILE ?? join(homedir(), '.qb');

export interface TokenSet {
  /** Which environment these tokens belong to. */
  env: string;
  /** OIDC authority (issuer base) — recorded so the API call targets the right env. */
  authority: string;
  clientId: string;
  /** Token endpoint, cached so refresh doesn't need rediscovery. */
  tokenEndpoint: string;
  accessToken: string;
  refreshToken: string | null;
  /** Absolute expiry in epoch milliseconds. */
  expiresAt: number;
}

/** Persist tokens to the store with owner-only permissions (0600). */
export function saveTokens(tokens: TokenSet): void {
  writeFileSync(STORE_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  chmodSync(STORE_PATH, 0o600); // enforce even if the file pre-existed with looser perms
}

export function loadTokens(): TokenSet | null {
  try {
    return JSON.parse(readFileSync(STORE_PATH, 'utf8')) as TokenSet;
  } catch {
    return null;
  }
}

export function clearTokens(): void {
  try {
    rmSync(STORE_PATH);
  } catch {
    /* already gone */
  }
}

export function tokenStorePath(): string {
  return STORE_PATH;
}
