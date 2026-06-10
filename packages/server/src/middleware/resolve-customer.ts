import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Make req.customerId available to every handler once resolveCustomer has run.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The resolved owning customer for this request; set by resolveCustomer. */
      customerId?: string;
    }
  }
}

/** Resolution configuration, read once from the environment at startup. */
export interface ResolveCustomerConfig {
  /** Name of the trusted identity header (e.g. `X-Customer-Id`, or `X-authentik-uid`). */
  customerHeader: string;
  /** When true, an unattributed request falls back to customer `"local"` instead of 401. */
  allowDefaultCustomer: boolean;
  /** When set, requests must carry a matching proxy-secret header (proof-of-proxy). */
  trustedProxySecret?: string;
  /** Name of the proxy-secret header checked when the secret is set. */
  proxySecretHeader: string;
}

/** The customer id used when the default fallback is enabled and no identity header is present. */
export const DEFAULT_CUSTOMER_ID = 'local';

/** Build config from environment variables; strict by default (no default customer, no proxy gate). */
export function configFromEnv(env: NodeJS.ProcessEnv): ResolveCustomerConfig {
  const secret = env.QB_TRUSTED_PROXY_SECRET;
  return {
    customerHeader: env.QB_CUSTOMER_HEADER ?? 'X-Customer-Id',
    allowDefaultCustomer: isTruthy(env.QB_ALLOW_DEFAULT_CUSTOMER),
    ...(secret !== undefined && secret !== '' ? { trustedProxySecret: secret } : {}),
    proxySecretHeader: env.QB_PROXY_SECRET_HEADER ?? 'X-Proxy-Secret',
  };
}

function isTruthy(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Constant-time secret compare. timingSafeEqual needs equal-length buffers, and comparing
 * raw lengths first would leak the secret's length, so both sides are hashed to a fixed-size
 * digest and the digests are compared. Equal digests ⇒ equal inputs (collision-resistant).
 */
function secretsMatch(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Resolve the owning customer for each request and set `req.customerId`. Ordered chain:
 *   1. Proxy-secret gate (if a secret is configured): the request must carry a matching
 *      secret header, compared in constant time. Absent/mismatch → 401, before identity.
 *   2. Identity header present → its value is the customer id.
 *   3. Identity header absent and default allowed → `"local"`.
 *   4. Else → 401.
 *
 * Resolution lives in this one place; routes read `req.customerId` and pass it explicitly.
 */
export function resolveCustomer(config: ResolveCustomerConfig): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (config.trustedProxySecret !== undefined) {
      const provided = headerValue(req, config.proxySecretHeader);
      if (provided === undefined || !secretsMatch(provided, config.trustedProxySecret)) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
    }

    const identity = headerValue(req, config.customerHeader);
    if (identity !== undefined && identity !== '') {
      req.customerId = identity;
      next();
      return;
    }

    if (config.allowDefaultCustomer) {
      req.customerId = DEFAULT_CUSTOMER_ID;
      next();
      return;
    }

    res.status(401).json({ error: 'unauthorized' });
  };
}

/**
 * The resolved customer id for a request that has passed resolveCustomer. Throws if called
 * on an unresolved request (a programming error — the middleware 401s before any handler runs).
 */
export function requireCustomerId(req: Request): string {
  if (req.customerId === undefined) {
    throw new Error('customerId not resolved — resolveCustomer middleware must run first');
  }
  return req.customerId;
}

/** Read a single header value by name (case-insensitive); arrays collapse to the first entry. */
function headerValue(req: Request, name: string): string | undefined {
  const raw = req.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}
