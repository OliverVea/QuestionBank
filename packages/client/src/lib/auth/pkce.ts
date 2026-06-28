/** Base64url-encode bytes (no padding) — the PKCE/JOSE encoding. */
function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBase64url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** A PKCE code verifier (43 chars from 32 random bytes). */
export function generateVerifier(): string {
  return randomBase64url(32);
}

/** An opaque anti-CSRF state value. */
export function generateState(): string {
  return randomBase64url(16);
}

/** The S256 code challenge for a verifier. */
export async function challengeFromVerifier(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return base64url(new Uint8Array(digest));
}
