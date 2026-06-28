import type { Request, RequestHandler } from 'express';
import { AUDIENCE } from '@qb/auth-config';
import { createVerifier, type VerifyBearer } from './verify-bearer.js';

// Make req.customerId available to every handler once requireAuth has run.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The authenticated tenant for this request; set by requireAuth from the token sub. */
      customerId?: string;
    }
  }
}

/**
 * Express middleware that requires a valid Authorization: Bearer token. The presence check
 * is delegated to the verifier (an empty token throws), so a single 401 path covers missing,
 * malformed, and invalid tokens without leaking which.
 */
export function requireAuth(verify: VerifyBearer): RequestHandler {
  return async (req, res, next): Promise<void> => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    try {
      const { customerId } = await verify(token);
      req.customerId = customerId;
      next();
    } catch {
      res.status(401).json({ error: 'unauthorized' });
    }
  };
}

/**
 * The authenticated customer id for a request that has passed requireAuth. Throws if called
 * on an unauthenticated request (a programming error — requireAuth 401s before any handler runs).
 */
export function requireCustomerId(req: Request): string {
  if (req.customerId === undefined) {
    throw new Error('customerId not set — requireAuth middleware must run first');
  }
  return req.customerId;
}

/** Build a verifier from the environment. Lazy — never throws at construction. */
export function verifierFromEnv(env: NodeJS.ProcessEnv = process.env): VerifyBearer {
  return createVerifier({
    authority: env.QB_OIDC_AUTHORITY ?? '',
    audience: env.QB_OIDC_AUDIENCE ?? AUDIENCE,
  });
}
