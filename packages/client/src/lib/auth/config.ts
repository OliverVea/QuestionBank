import { AUTHORITIES, CLIENT_ID, SCOPES, type EnvName } from '@qb/auth-config';

/** Map the current hostname to an OIDC environment. localhost → beta (dev convenience). */
export function currentEnv(host: string = window.location.hostname): EnvName {
  if (host === 'questionbank.ovea.pro') return 'prod';
  return 'beta'; // questionbank-beta.ovea.pro, localhost, previews
}

export interface ClientAuthConfig {
  authority: string;
  clientId: string;
  scopes: string;
  redirectUri: string;
}

export function authConfig(): ClientAuthConfig {
  return {
    authority: AUTHORITIES[currentEnv()],
    clientId: CLIENT_ID,
    scopes: SCOPES,
    redirectUri: `${window.location.origin}/auth/callback`,
  };
}
