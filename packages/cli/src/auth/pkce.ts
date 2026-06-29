import { createHash, randomBytes } from 'node:crypto';

/** A PKCE code verifier (43 chars from 32 random bytes). */
export function generateVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** An opaque anti-CSRF state value. */
export function generateState(): string {
  return randomBytes(16).toString('base64url');
}

/** The S256 code challenge for a verifier. */
export function challengeFromVerifier(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
