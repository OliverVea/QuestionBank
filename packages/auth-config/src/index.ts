/**
 * Single source of truth for QuestionBank's OIDC identity. Imported by the server
 * (resource-server validation), the client (browser PKCE flow), and later the CLI.
 * Config + types only — no runtime behaviour beyond URL composition.
 */

/** The OAuth2 client id of the QuestionBank application registered in Authentik. */
export const CLIENT_ID = 'questionbank' as const;

/** The token `aud` the API validates. Authentik issues `aud = client_id`. */
export const AUDIENCE = CLIENT_ID;

/** Scopes the SPA requests. */
export const SCOPES = 'openid profile email' as const;

/**
 * The single place that names which claim carries the tenant id. Changing this is a
 * data-model change (see the re-key migration), never a per-consumer tweak.
 */
export const CUSTOMER_CLAIM = 'sub' as const;

/** Per-environment OIDC authority (issuer base). Always ends with a trailing slash. */
export const AUTHORITIES = {
  beta: 'https://auth-beta.ovea.pro/application/o/questionbank/',
  prod: 'https://auth.ovea.pro/application/o/questionbank/',
} as const;

export type EnvName = keyof typeof AUTHORITIES;

/** The OIDC discovery document URL for an authority. */
export function discoveryUrl(authority: string): string {
  // Authority always ends with '/', so concatenation yields a well-formed URL.
  return `${authority}.well-known/openid-configuration`;
}

/** Shape of the discovery fields both consumers rely on. */
export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}
