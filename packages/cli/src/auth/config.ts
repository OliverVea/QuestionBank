import { AUTHORITIES, CLIENT_ID, SCOPES, type EnvName } from '@qb/auth-config';

/**
 * API base per env. prod has a public ingress; beta is ClusterIP-only and must be reached
 * through `kubectl -n apps-beta port-forward svc/questionbank 8088:80`.
 */
const API_BASES: Record<EnvName, string> = {
  prod: 'https://questionbank.ovea.pro',
  beta: 'http://localhost:8088',
};

export interface CliAuthConfig {
  env: EnvName;
  authority: string;
  clientId: string;
  scopes: string;
  apiBase: string;
}

/** Resolve the OIDC + API config for an environment (defaults to prod — the real user identity). */
export function authConfig(env: EnvName = 'prod'): CliAuthConfig {
  return {
    env,
    authority: AUTHORITIES[env],
    clientId: CLIENT_ID,
    // offline_access so the CLI is issued a refresh token (long-lived sessions); the SPA keeps SCOPES.
    scopes: `${SCOPES} offline_access`,
    apiBase: API_BASES[env],
  };
}
