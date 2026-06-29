import { discoveryUrl, type OidcDiscovery } from '@qb/auth-config';

const cache = new Map<string, Promise<OidcDiscovery>>();

/** Fetch (and cache, per authority) the OIDC discovery document. */
export function discover(authority: string): Promise<OidcDiscovery> {
  let pending = cache.get(authority);
  if (!pending) {
    pending = (async () => {
      const res = await fetch(discoveryUrl(authority));
      if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
      return (await res.json()) as OidcDiscovery;
    })();
    cache.set(authority, pending);
  }
  return pending;
}
