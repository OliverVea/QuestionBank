import type { VerifyBearer } from '../auth/index.js';

/** Default tenant for route/UAT tests that don't care about identity. */
export const TEST_CUSTOMER = 'local';

/**
 * A verifier that ignores the token and always resolves to `customerId`. Lets existing route
 * tests keep issuing un-headered requests: requireAuth calls verify('') and this accepts it.
 */
export function fakeVerifier(customerId: string = TEST_CUSTOMER): VerifyBearer {
  return async () => ({ customerId, claims: { sub: customerId } });
}

/**
 * A verifier whose customerId IS the bearer token value (empty token rejected). Used by the
 * segmentation suite: `Authorization: Bearer alice` authenticates as customer "alice".
 */
export function identityFromTokenVerifier(): VerifyBearer {
  return async (token: string) => {
    if (!token) throw new Error('no token');
    return { customerId: token, claims: { sub: token } };
  };
}
