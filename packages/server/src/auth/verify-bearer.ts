import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import { CUSTOMER_CLAIM, discoveryUrl, type OidcDiscovery } from '@qb/auth-config';

export interface VerifierConfig {
  /** OIDC authority (issuer base), ending in '/'. Used for discovery when no jwks injected. */
  authority: string;
  /** Token `aud` to require. */
  audience: string;
  /** Expected issuer. When omitted, taken from discovery (or `authority` in tests). */
  issuer?: string;
  /** Injectable JWKS for tests; defaults to a remote set fetched from discovery. */
  jwks?: JWTVerifyGetKey;
}

export interface VerifiedToken {
  customerId: string;
  claims: JWTPayload;
}

export type VerifyBearer = (token: string) => Promise<VerifiedToken>;

/**
 * Build a bearer verifier. Discovery (issuer + jwks_uri) is fetched lazily on first use and
 * cached for the verifier's lifetime; the remote JWKS itself is cached by `jose`. Tests inject
 * `jwks` + `issuer` to bypass the network entirely.
 */
export function createVerifier(config: VerifierConfig): VerifyBearer {
  let ready: Promise<{ jwks: JWTVerifyGetKey; issuer: string }> | null = null;

  const init = (): Promise<{ jwks: JWTVerifyGetKey; issuer: string }> => {
    if (ready) return ready;
    ready = (async () => {
      if (config.jwks) {
        return { jwks: config.jwks, issuer: config.issuer ?? config.authority };
      }
      if (!config.authority) {
        throw new Error('OIDC not configured: QB_OIDC_AUTHORITY is required');
      }
      const res = await fetch(discoveryUrl(config.authority));
      if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
      const doc = (await res.json()) as OidcDiscovery;
      // Discovery JSON is untrusted: a missing issuer would silently disable iss
      // validation in jwtVerify, and a missing jwks_uri would throw an opaque URL error.
      if (!doc.issuer) {
        throw new Error(`OIDC discovery missing "issuer" from ${discoveryUrl(config.authority)}`);
      }
      if (!doc.jwks_uri) {
        throw new Error(`OIDC discovery missing "jwks_uri" from ${discoveryUrl(config.authority)}`);
      }
      return {
        jwks: createRemoteJWKSet(new URL(doc.jwks_uri)),
        issuer: config.issuer ?? doc.issuer,
      };
    })().catch((err: unknown) => {
      // Reset so a transient failure doesn't brick the verifier for the process lifetime.
      ready = null;
      throw err;
    });
    return ready;
  };

  return async (token: string): Promise<VerifiedToken> => {
    const { jwks, issuer } = await init();
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: config.audience,
    });
    const customerId = payload[CUSTOMER_CLAIM];
    // Reject empty AND whitespace-only sub — a blank tenant id must never reach storage.
    if (typeof customerId !== 'string' || customerId.trim().length === 0) {
      throw new Error(`token missing "${CUSTOMER_CLAIM}" claim`);
    }
    return { customerId, claims: payload };
  };
}
