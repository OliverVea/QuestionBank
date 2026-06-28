# QuestionBank API + SPA: Authentik OIDC (replace forward-auth) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Authentik forward-auth header-trust model with standard app-level OIDC — the QB API validates Authentik-issued JWTs (resource server), the SPA logs in via browser auth-code + PKCE, and `req.customerId` comes from the token `sub`.

**Architecture:** A new shared `@qb/auth-config` package names the authorities, client id, scopes, and tenant claim once. The server gains a `src/auth/` module (`verifyBearer` + `requireAuth`, built on `jose`) that fully replaces `resolveCustomer`. The client gains a `src/lib/auth/` module (PKCE flow, token store, `authFetch`) plus a callback bootstrap. Existing prod data is re-keyed from the legacy `X-authentik-uid` value to the user's `sub` by an idempotent script. Forward-auth is dropped from ingress and the proxy provider retired, in an additive-first cutover across three repos.

**Tech Stack:** TypeScript (ES2022, NodeNext server / Bundler client), npm workspaces, Express 5, `jose`, Vite + navigo (vanilla SPA, no framework), Vitest, Authentik OAuth2 (ArgoCD-managed blueprints), Helm (Olve.Pipelines + ArgoCD).

**Repos touched:** `QuestionBank` (code), `Olve.Homelab` (`helm/values-{beta,prod}.yaml`), `homelab` (`infra/authentik/{beta,prod}/blueprints`).

**Locked decisions (do not reopen):** replace-everywhere (no coexist); big-bang beta+prod; `sub`→customerId with one-time re-key; Authentik machine client (client-credentials) for beta smoke; auth as its own module; correct/standard way, no shortcuts.

---

## File Structure

### New files — QuestionBank
- `packages/auth-config/package.json` — new shared workspace package `@qb/auth-config`
- `packages/auth-config/tsconfig.json`
- `packages/auth-config/src/index.ts` — authorities, client id, scopes, audience, `CUSTOMER_CLAIM`, discovery-url helper (config + types only)
- `packages/server/src/auth/verify-bearer.ts` — `createVerifier()` → `verifyBearer(token)` (JWKS, iss/aud/exp/nbf, `sub`→customerId)
- `packages/server/src/auth/require-auth.ts` — `requireAuth()` middleware, `requireCustomerId()`, `verifierFromEnv()`, `Express.Request.customerId` augmentation
- `packages/server/src/auth/index.ts` — barrel
- `packages/server/src/auth/verify-bearer.test.ts`, `require-auth.test.ts`
- `packages/server/src/test-support/auth.ts` — `fakeVerifier()`, `identityFromTokenVerifier()`, `TEST_CUSTOMER`
- `packages/server/src/scripts/rekey-customer.ts` — idempotent `sub` re-key migration + CLI
- `packages/server/src/scripts/rekey-customer.test.ts`
- `packages/client/src/lib/auth/config.ts` — runtime authority resolution (by hostname), redirect uri
- `packages/client/src/lib/auth/pkce.ts` — verifier/challenge/state (SubtleCrypto)
- `packages/client/src/lib/auth/storage.ts` — token + PKCE/return-to persistence (sessionStorage)
- `packages/client/src/lib/auth/discovery.ts` — cached OIDC discovery
- `packages/client/src/lib/auth/oidc.ts` — `login`, `handleCallback`, `logout`, `getAccessToken`, `refresh`, `buildAuthorizeUrl`
- `packages/client/src/lib/auth/auth-fetch.ts` — bearer-attaching `fetch` wrapper + 401 hook seam
- `packages/client/src/lib/auth/index.ts` — barrel
- `packages/client/src/pages/AuthCallbackPage.ts` — "Signing in…" view
- `packages/client/tests/unit/lib/auth/*.test.ts` — pkce, storage, discovery, oidc, auth-fetch

### Modified files — QuestionBank
- `package.json` (root) — `build:auth-config` script, dev/build ordering
- `tsconfig.json` (root) — reference `./packages/auth-config`
- `vitest.config.ts` — `@qb/auth-config` alias for server/client/beta projects
- `packages/server/package.json` — add `jose` + `@qb/auth-config` deps
- `packages/server/tsconfig.json` — reference + `paths` for `@qb/auth-config` (tsx dev)
- `packages/client/package.json` — add `@qb/auth-config` dep
- `packages/client/tsconfig.json` — reference `@qb/auth-config`
- `packages/client/vite.config.ts` — `@qb/auth-config` alias
- `packages/server/src/index.ts` — `requireAuth` replaces `resolveCustomer`; `verifierFromEnv` default; startup env check
- `packages/server/src/routes/*.ts` (14 files) — import `requireCustomerId` from `../auth/index.js`
- `packages/server/src/middleware/resolve-customer.ts` — **deleted**
- `packages/server/src/test-setup.ts` — drop `QB_ALLOW_DEFAULT_CUSTOMER`
- `packages/server/src/uat/api-uat.test.ts`, `routes/{figures,scan,extract}.test.ts` — inject verifier
- `packages/server/tests/beta/smoke.beta.test.ts` — machine-client bearer instead of header
- `packages/client/src/main.ts` — callback bootstrap + login-if-no-token
- `packages/client/src/pages/*.ts`, `pages/grade/grade-api.ts` — `authFetch` instead of `fetch`
- `helm/values-beta.yaml`, `helm/values-minimal.yaml` — drop `QB_CUSTOMER_HEADER`, add OIDC env
- `.pipelines/config.yaml`, `.pipelines/scripts/test-after-beta.sh` — machine-client secrets
- `.claude/skills/calling-the-questionbank-api/SKILL.md` — token flow

### Modified files — other repos
- `Olve.Homelab/helm/values-beta.yaml`, `helm/values-prod.yaml` — drop `forwardAuthMiddleware`
- `homelab/infra/authentik/{beta,prod}/blueprints/applications.yaml` — `questionbank` OAuth2 provider + app (+ beta machine client)
- `homelab/infra/authentik/{beta,prod}/blueprints/outpost.yaml` — retire proxy provider (cutover)

---

## Conventions for every task
- Server imports use explicit `.js` extensions (NodeNext). Client imports use the `@/` alias.
- Run a single server test: `npx vitest run --project server <path> -t '<name>'`
- Run a single client test: `npx vitest run --project client <path> -t '<name>'`
- Typecheck everything: `npm run typecheck`
- Commit after each task; never `git add -A` (there are unrelated pre-existing edits to `helm/values-*.yaml`, `docs/mocks/AGENTS.md`, `services/figure-service/README.md` — leave them).

---

# Phase 0 — Shared config package `@qb/auth-config`

### Task 0.1: Scaffold and wire `@qb/auth-config`

**Files:**
- Create: `packages/auth-config/package.json`, `packages/auth-config/tsconfig.json`, `packages/auth-config/src/index.ts`
- Modify: `package.json` (root), `tsconfig.json` (root), `vitest.config.ts`

- [ ] **Step 1: Create the package manifest**

`packages/auth-config/package.json`:
```json
{
  "name": "@qb/auth-config",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b"
  }
}
```

- [ ] **Step 2: Create the package tsconfig**

`packages/auth-config/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write the config module (config + types only, no logic)**

`packages/auth-config/src/index.ts`:
```ts
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
```

- [ ] **Step 4: Reference the package from the root tsconfig**

Edit `tsconfig.json` (root) — add the reference:
```json
{
  "files": [],
  "references": [
    { "path": "./packages/auth-config" },
    { "path": "./packages/server" },
    { "path": "./packages/client" }
  ]
}
```

- [ ] **Step 5: Wire root build/dev ordering**

Edit root `package.json` scripts so `@qb/auth-config` is built before consumers (server dev via `tsx` resolves the package through node, so its `dist/` must exist):
```json
    "dev": "npm run build:auth-config && npm-run-all --parallel dev:server dev:client",
    "dev:server": "npm --workspace @qb/server run dev",
    "dev:client": "npm --workspace @qb/client run dev",
    "build": "npm-run-all --serial build:auth-config build:server build:client",
    "build:auth-config": "npm --workspace @qb/auth-config run build",
    "build:server": "npm --workspace @qb/server run build",
    "build:client": "npm --workspace @qb/client run build",
```
(Keep the other scripts unchanged.)

- [ ] **Step 6: Add the vitest alias so tests resolve source without a prebuild**

Edit `vitest.config.ts`. Add the alias to the **server**, **client**, and **beta** projects. For server (already has a `resolve.alias`):
```ts
        resolve: {
          alias: {
            '@': r('./packages/server/src'),
            '@qb/auth-config': r('./packages/auth-config/src/index.ts'),
          },
        },
```
For client (already has a `resolve.alias`):
```ts
        resolve: {
          alias: {
            '@': r('./packages/client/src'),
            '@qb/auth-config': r('./packages/auth-config/src/index.ts'),
          },
        },
```
For the **beta** project (currently has no `resolve` block) add one:
```ts
        test: {
          name: 'beta',
          environment: 'node',
          include: ['packages/server/tests/beta/**/*.beta.test.ts'],
          exclude: [...configDefaults.exclude, '**/dist/**'],
        },
        resolve: {
          alias: { '@qb/auth-config': r('./packages/auth-config/src/index.ts') },
        },
```

- [ ] **Step 7: Install workspaces and build the package**

Run:
```bash
cd /home/oliver/projects/QuestionBank && npm install && npm run build:auth-config
```
Expected: install succeeds; `packages/auth-config/dist/index.js` and `index.d.ts` exist.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: PASS (the new project compiles; nothing else changed yet).

- [ ] **Step 9: Commit**

```bash
git add packages/auth-config package.json tsconfig.json vitest.config.ts package-lock.json
git commit -m "feat(auth-config): add @qb/auth-config shared OIDC config package"
```

---

# Phase 1 — Server auth module

### Task 1.1: Add `jose` and the `@qb/auth-config` dependency to the server

**Files:** Modify `packages/server/package.json`, `packages/server/tsconfig.json`

- [ ] **Step 1: Add dependencies**

Run:
```bash
cd /home/oliver/projects/QuestionBank && npm install jose --workspace @qb/server
```
Then edit `packages/server/package.json` to add `@qb/auth-config` under `dependencies` (npm workspaces links it locally):
```json
  "dependencies": {
    "@anthropic-ai/sdk": "^0.102.0",
    "@qb/auth-config": "*",
    "express": "^5.2.1",
    "jose": "^6.1.0",
    "multer": "^2.1.1",
    "sharp": "^0.35.2"
  },
```
(Use whatever `jose` version `npm install` resolved; keep alphabetical order.)

- [ ] **Step 2: Reference `@qb/auth-config` in the server tsconfig**

Edit `packages/server/tsconfig.json`. Add a project **reference** only — do NOT add a `paths` alias for `@qb/auth-config`. NodeNext resolves the bare `@qb/auth-config` specifier through the workspace symlink to the built `dist/index.d.ts`, and the reference guarantees `tsc -b` builds it first. (A `paths` alias pointing at `../auth-config/src/index.ts` would make `tsc -b` treat that source as a server input outside `rootDir` and fail with `TS6059`; `tsx` dev resolves via node→dist and vitest via the alias in `vitest.config.ts`, so no `paths` entry is needed.)
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"],
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    },
    "ignoreDeprecations": "6.0"
  },
  "references": [{ "path": "../auth-config" }],
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Run install + typecheck**

Run: `npm install && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/package.json packages/server/tsconfig.json package-lock.json
git commit -m "build(server): add jose and @qb/auth-config dependencies"
```

---

### Task 1.2: `verifyBearer` (JWT validation)

**Files:**
- Create: `packages/server/src/auth/verify-bearer.ts`
- Test: `packages/server/src/auth/verify-bearer.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/server/src/auth/verify-bearer.test.ts`:
```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWTPayload } from 'jose';
import { createVerifier } from './verify-bearer.js';

const ISS = 'https://auth.example.test/application/o/questionbank/';
const AUD = 'questionbank';

let signToken: (claims: JWTPayload, opts?: { iss?: string; aud?: string; exp?: string }) => Promise<string>;
let badSigToken: (claims: JWTPayload) => Promise<string>;
let verify: ReturnType<typeof createVerifier>;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  const jwks = createLocalJWKSet({ keys: [jwk] });

  // A second, unrelated key — its tokens must fail signature verification.
  const other = await generateKeyPair('RS256');

  signToken = (claims, opts = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(opts.iss ?? ISS)
      .setAudience(opts.aud ?? AUD)
      .setExpirationTime(opts.exp ?? '2h')
      .sign(privateKey);

  badSigToken = (claims) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(ISS)
      .setAudience(AUD)
      .setExpirationTime('2h')
      .sign(other.privateKey);

  verify = createVerifier({ authority: ISS, issuer: ISS, audience: AUD, jwks });
});

describe('verifyBearer', () => {
  it('accepts a valid token and resolves sub -> customerId', async () => {
    const token = await signToken({ sub: 'cust-123' });
    const result = await verify(token);
    expect(result.customerId).toBe('cust-123');
    expect(result.claims.sub).toBe('cust-123');
  });

  it('rejects an expired token', async () => {
    const token = await signToken({ sub: 'cust-123' }, { exp: '-1h' });
    await expect(verify(token)).rejects.toThrow();
  });

  it('rejects a wrong issuer', async () => {
    const token = await signToken({ sub: 'cust-123' }, { iss: 'https://evil.test/' });
    await expect(verify(token)).rejects.toThrow();
  });

  it('rejects a wrong audience', async () => {
    const token = await signToken({ sub: 'cust-123' }, { aud: 'someone-else' });
    await expect(verify(token)).rejects.toThrow();
  });

  it('rejects a bad signature', async () => {
    const token = await badSigToken({ sub: 'cust-123' });
    await expect(verify(token)).rejects.toThrow();
  });

  it('rejects a token missing the sub claim', async () => {
    const token = await signToken({ name: 'no-sub' });
    await expect(verify(token)).rejects.toThrow(/sub/);
  });

  it('rejects an empty token string', async () => {
    await expect(verify('')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project server packages/server/src/auth/verify-bearer.test.ts`
Expected: FAIL — cannot import `./verify-bearer.js` (module not found).

- [ ] **Step 3: Implement `verify-bearer.ts`**

`packages/server/src/auth/verify-bearer.ts`:
```ts
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
      return {
        jwks: createRemoteJWKSet(new URL(doc.jwks_uri)),
        issuer: config.issuer ?? doc.issuer,
      };
    })();
    return ready;
  };

  return async (token: string): Promise<VerifiedToken> => {
    const { jwks, issuer } = await init();
    // jwtVerify validates signature, exp, and nbf; issuer + audience are explicit.
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: config.audience,
    });
    const customerId = payload[CUSTOMER_CLAIM];
    if (typeof customerId !== 'string' || customerId.length === 0) {
      throw new Error(`token missing "${CUSTOMER_CLAIM}" claim`);
    }
    return { customerId, claims: payload };
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project server packages/server/src/auth/verify-bearer.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/verify-bearer.ts packages/server/src/auth/verify-bearer.test.ts
git commit -m "feat(server): add verifyBearer JWT validation (jose)"
```

---

### Task 1.3: `requireAuth` middleware + `requireCustomerId` + `verifierFromEnv`

**Files:**
- Create: `packages/server/src/auth/require-auth.ts`
- Test: `packages/server/src/auth/require-auth.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/server/src/auth/require-auth.test.ts`:
```ts
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { requireAuth, requireCustomerId, verifierFromEnv } from './require-auth.js';
import type { VerifyBearer } from './verify-bearer.js';

function appWith(verify: VerifyBearer): express.Express {
  const app = express();
  app.use('/api', requireAuth(verify));
  app.get('/api/whoami', (req, res) => {
    res.json({ customerId: requireCustomerId(req) });
  });
  return app;
}

const ok: VerifyBearer = async (token) => {
  if (!token) throw new Error('no token');
  return { customerId: 'cust-7', claims: { sub: 'cust-7' } };
};

describe('requireAuth', () => {
  it('401s when no Authorization header is present', async () => {
    const res = await request(appWith(ok)).get('/api/whoami');
    expect(res.status).toBe(401);
  });

  it('401s when the verifier rejects the token', async () => {
    const reject: VerifyBearer = async () => {
      throw new Error('bad token');
    };
    const res = await request(appWith(reject)).get('/api/whoami').set('Authorization', 'Bearer x');
    expect(res.status).toBe(401);
  });

  it('passes and sets req.customerId on a valid token', async () => {
    const res = await request(appWith(ok)).get('/api/whoami').set('Authorization', 'Bearer good');
    expect(res.status).toBe(200);
    expect(res.body.customerId).toBe('cust-7');
  });
});

describe('verifierFromEnv', () => {
  it('builds without throwing even when env is unset (lazy)', () => {
    expect(() => verifierFromEnv({})).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project server packages/server/src/auth/require-auth.test.ts`
Expected: FAIL — cannot import `./require-auth.js`.

- [ ] **Step 3: Implement `require-auth.ts`**

`packages/server/src/auth/require-auth.ts`:
```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project server packages/server/src/auth/require-auth.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/require-auth.ts packages/server/src/auth/require-auth.test.ts
git commit -m "feat(server): add requireAuth middleware and verifierFromEnv"
```

---

### Task 1.4: Auth module barrel

**Files:** Create `packages/server/src/auth/index.ts`

- [ ] **Step 1: Write the barrel**

`packages/server/src/auth/index.ts`:
```ts
export { createVerifier, type VerifierConfig, type VerifiedToken, type VerifyBearer } from './verify-bearer.js';
export { requireAuth, requireCustomerId, verifierFromEnv } from './require-auth.js';
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`
Expected: PASS.
```bash
git add packages/server/src/auth/index.ts
git commit -m "feat(server): add auth module barrel"
```

---

# Phase 2 — Server wiring & cleanup

### Task 2.1: Test-support auth helpers

**Files:** Create `packages/server/src/test-support/auth.ts`

- [ ] **Step 1: Write the helpers**

`packages/server/src/test-support/auth.ts`:
```ts
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
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`
Expected: PASS.
```bash
git add packages/server/src/test-support/auth.ts
git commit -m "test(server): add auth test-support verifiers"
```

---

### Task 2.2: Repoint `requireCustomerId` imports and delete `resolve-customer.ts`

> The 14 route files import `requireCustomerId` from `../middleware/resolve-customer.js`. Repoint them to the new auth module, then delete the old middleware. (Wiring in `index.ts` is updated in Task 2.3.)

**Files:** Modify `packages/server/src/routes/{attempts,skip,transcribe,grade,extract,practice,settings,scan,learn,books,questions,activity,figures}.ts`; delete `packages/server/src/middleware/resolve-customer.ts`

- [ ] **Step 1: Repoint every route import**

In each of these 13 route files, change the import line:
```ts
import { requireCustomerId } from '../middleware/resolve-customer.js';
```
to:
```ts
import { requireCustomerId } from '../auth/index.js';
```
Files (exact list): `attempts.ts`, `skip.ts`, `transcribe.ts`, `grade.ts`, `extract.ts`, `practice.ts`, `settings.ts`, `scan.ts`, `learn.ts`, `books.ts`, `questions.ts`, `activity.ts`, `figures.ts`.

Verify none remain:
```bash
grep -rn "middleware/resolve-customer" packages/server/src/routes
```
Expected: no output.

- [ ] **Step 2: Delete the old middleware**

Run:
```bash
git rm packages/server/src/middleware/resolve-customer.ts
```
(Do not yet run typecheck — `index.ts` still imports it; fixed in Task 2.3.)

- [ ] **Step 3: Commit (with Task 2.3 — see below)**

> Do not commit yet; `index.ts` is broken until Task 2.3. Proceed directly to Task 2.3 and commit them together.

---

### Task 2.3: Rewire `index.ts` to use `requireAuth`

**Files:** Modify `packages/server/src/index.ts`

- [ ] **Step 1: Replace the middleware imports**

In `packages/server/src/index.ts`, remove:
```ts
import {
  configFromEnv,
  resolveCustomer,
  type ResolveCustomerConfig,
} from './middleware/resolve-customer.js';
```
and add (next to the other local imports):
```ts
import { requireAuth, verifierFromEnv } from './auth/index.js';
import type { VerifyBearer } from './auth/index.js';
```

- [ ] **Step 2: Update `createApp` signature and the gate**

Change the `createApp` signature's 4th parameter from the customer config to a verifier:
```ts
export function createApp(
  store: Store,
  provider: LlmProvider,
  figureService: FigureServiceClient | null = figureServiceFromEnv(),
  verify: VerifyBearer = verifierFromEnv(),
): Express {
```
Replace the gate line (currently `app.use('/api', resolveCustomer(customerConfig));`) with:
```ts
  // Every /api route below requires a valid Authentik-issued bearer token.
  app.use('/api', requireAuth(verify));
```
(Leave both `/api/health` and `/api/health/connectivity` exactly where they are — registered before the gate, so they stay open.)

- [ ] **Step 3: Fail fast at startup if OIDC env is missing**

In `main()`, before `createApp`, add an explicit check (the env verifier is lazy and would otherwise only fail on the first request):
```ts
async function main(): Promise<void> {
  if (!process.env.QB_OIDC_AUTHORITY) {
    throw new Error('QB_OIDC_AUTHORITY is required (OIDC authority, e.g. https://auth.ovea.pro/application/o/questionbank/)');
  }
  const store = await Store.open(DATA_DIR);
  const provider = new AnthropicApiProvider();
  const app = createApp(store, provider);
  // ...unchanged...
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: FAIL only in the existing tests that pass a `ResolveCustomerConfig` / rely on default-customer (api-uat, figures, scan, extract). Production source compiles. (These tests are fixed in Task 2.4.)

- [ ] **Step 5: Commit the source rewire (Tasks 2.2 + 2.3 together)**

```bash
git add packages/server/src/index.ts packages/server/src/routes
git commit -m "refactor(server): replace resolveCustomer with requireAuth (OIDC bearer)"
```

---

### Task 2.4: Migrate existing server tests to the verifier

**Files:** Modify `packages/server/src/test-setup.ts`, `packages/server/src/routes/{figures,scan,extract}.test.ts`, `packages/server/src/uat/api-uat.test.ts`

- [ ] **Step 1: Neutralize the test-setup default**

Replace the body of `packages/server/src/test-setup.ts` with:
```ts
// OIDC auth is injected per-test via createApp's 4th arg (see src/test-support/auth.ts).
// There is no global default-customer fallback any more, so this setup file is intentionally empty.
export {};
```
(Keep the file — `vitest.config.ts` references it as a setup file.)

- [ ] **Step 2: `figures.test.ts` — inject the fake verifier**

At the top of `packages/server/src/routes/figures.test.ts` add the import:
```ts
import { fakeVerifier } from '../test-support/auth.js';
```
Change `createApp(store, new FakeProvider(), null)` to:
```ts
return createApp(store, new FakeProvider(), null, fakeVerifier());
```

- [ ] **Step 3: `extract.test.ts` — inject the fake verifier**

Add the import:
```ts
import { fakeVerifier } from '../test-support/auth.js';
```
Replace every `createApp(store, <provider>, undefined)` with `createApp(store, <provider>, undefined, fakeVerifier())` (9 call sites at lines ~35, 67, 74, 82, 91, 105, 121, 151, 180 — keep each provider argument as-is).

- [ ] **Step 4: `scan.test.ts` — inject the fake verifier**

Add the import:
```ts
import { fakeVerifier } from '../test-support/auth.js';
```
Append `, fakeVerifier()` as the 4th argument to each `createApp(...)` call (7 sites at lines ~65, 107, 139, 161, 183, 196, 206 — each currently passes the figure-service as the 3rd arg).

- [ ] **Step 5: `api-uat.test.ts` — main flows**

Add the import (near the existing imports):
```ts
import { fakeVerifier, identityFromTokenVerifier } from '../test-support/auth.js';
```
Remove the now-dead `type ResolveCustomerConfig` from the `'../index.js'` import (line ~84) — it no longer exists.
For the non-segmentation `createApp` calls, add `fakeVerifier()` as the verifier argument:
- line ~110 `app = createApp(store, provider, undefined)` → `createApp(store, provider, undefined, fakeVerifier())`
- line ~689 `app = createApp(store, p, undefined)` → `createApp(store, p, undefined, fakeVerifier())`
- the `scanApp` (line ~469, ~586), `extractApp` (~515), `refineApp` (~537) builders → add `fakeVerifier()` as the final argument (preserve the existing figureService/provider args).

- [ ] **Step 6: `api-uat.test.ts` — segmentation suite rework**

In the `UAT (security): customer segmentation is airtight` describe block:
- Delete the `STRICT` const (the `ResolveCustomerConfig` object).
- Change the app build to use the identity-from-token verifier:
```ts
    segApp = createApp(segStore, new FakeProvider(), undefined, identityFromTokenVerifier());
```
- Change the `as` tagging helper from the `X-Customer-Id` header to a bearer token (the token value is the customer id):
```ts
  /** Tag a supertest request with a customer identity (token value = customer id). */
  const as = (r: request.Test, customer: string) => r.set('Authorization', `Bearer ${customer}`);
```
The unattributed-request test (no `as(...)`) still sends no header, so `requireAuth` 401s — assertions unchanged.

- [ ] **Step 7: Run the full server suite**

Run: `npm run test:server`
Expected: PASS (all server unit + UAT tests green).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/test-setup.ts packages/server/src/routes/figures.test.ts packages/server/src/routes/scan.test.ts packages/server/src/routes/extract.test.ts packages/server/src/uat/api-uat.test.ts
git commit -m "test(server): authenticate route/UAT tests via injected verifier"
```

---

# Phase 3 — Data migration (`sub` re-key)

### Task 3.1: Idempotent re-key migration script

> Storage is flat JSON arrays per entity under `QB_DATA_DIR` (`books.json`, `questions.json`, `attempts.json`, `skips.json`, `figures.json`, `settings.json`). Each row carries `customerId`; **`settings.json` rows also use `id === customerId`** (so settings need both fields remapped). Figure blobs in `imgs/` are keyed by figure id (not customer), so they are untouched. The migration edits raw files — it never deletes, so blobs are safe.

**Files:**
- Create: `packages/server/src/scripts/rekey-customer.ts`
- Test: `packages/server/src/scripts/rekey-customer.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/server/src/scripts/rekey-customer.test.ts`:
```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../storage/store.js';
import { rekeyCustomer } from './rekey-customer.js';

const OLD = 'legacy-uid';
const NEW = '11111111-2222-3333-4444-555555555555';

let dir: string;

async function seed(customerId: string): Promise<void> {
  const store = await Store.open(dir);
  const book = await store.books.create(customerId, {
    id: 'b1', customerId, title: 'T', author: 'A', isbn: null,
    questionIds: [], learningGoal: null, createdAt: '2026-01-01T00:00:00.000Z',
  } as Parameters<typeof store.books.create>[1]);
  await store.questions.create(customerId, {
    id: 'q1', customerId, bookId: book.id, label: '1', canonicalText: 'q',
    relevance: null, source: null, createdAt: '2026-01-01T00:00:00.000Z',
  } as Parameters<typeof store.questions.create>[1]);
  await store.attempts.create(customerId, {
    id: 'a1', customerId, questionId: 'q1', answer: 'x',
    recommendedGrade: 'correct', rating: 'correct', issues: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  } as Parameters<typeof store.attempts.create>[1]);
  await store.settings.create(customerId, {
    id: customerId, customerId, daysGoal: 5, problemsGoal: 10, pauseEvery: 3,
  } as Parameters<typeof store.settings.create>[1]);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qb-rekey-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('rekeyCustomer', () => {
  it('moves every row from OLD to NEW and remaps settings id', async () => {
    await seed(OLD);

    const summary = await rekeyCustomer({ dataDir: dir, oldId: OLD, newId: NEW });
    expect(summary.changed.books).toBe(1);
    expect(summary.changed.questions).toBe(1);
    expect(summary.changed.attempts).toBe(1);
    expect(summary.changed.settings).toBe(1);

    const store = await Store.open(dir);
    expect(await store.books.getAll(NEW)).toHaveLength(1);
    expect(await store.questions.getAll(NEW)).toHaveLength(1);
    expect(await store.attempts.getAll(NEW)).toHaveLength(1);
    expect(await store.books.getAll(OLD)).toHaveLength(0);

    const settings = await store.settings.getById(NEW, NEW);
    expect(settings?.customerId).toBe(NEW);
    expect(settings?.id).toBe(NEW);
  });

  it('is idempotent — a second run changes nothing', async () => {
    await seed(OLD);
    await rekeyCustomer({ dataDir: dir, oldId: OLD, newId: NEW });
    const second = await rekeyCustomer({ dataDir: dir, oldId: OLD, newId: NEW });
    expect(second.changed.books).toBe(0);
    expect(second.changed.settings).toBe(0);
  });

  it('dry-run reports counts without writing', async () => {
    await seed(OLD);
    const summary = await rekeyCustomer({ dataDir: dir, oldId: OLD, newId: NEW, dryRun: true });
    expect(summary.changed.books).toBe(1);

    const store = await Store.open(dir);
    expect(await store.books.getAll(OLD)).toHaveLength(1); // unchanged on disk
    expect(await store.books.getAll(NEW)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project server packages/server/src/scripts/rekey-customer.test.ts`
Expected: FAIL — cannot import `./rekey-customer.js`.

- [ ] **Step 3: Implement `rekey-customer.ts`**

`packages/server/src/scripts/rekey-customer.ts`:
```ts
import { cp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Collections to re-key. `remapId` is true only for settings (id === customerId). */
const COLLECTIONS = [
  { file: 'books.json', remapId: false },
  { file: 'questions.json', remapId: false },
  { file: 'attempts.json', remapId: false },
  { file: 'skips.json', remapId: false },
  { file: 'figures.json', remapId: false },
  { file: 'settings.json', remapId: true },
] as const;

type CollectionName =
  'books' | 'questions' | 'attempts' | 'skips' | 'figures' | 'settings';

export interface RekeyOptions {
  dataDir: string;
  oldId: string;
  newId: string;
  /** When true, compute counts but write nothing. */
  dryRun?: boolean;
}

export interface RekeySummary {
  changed: Record<CollectionName, number>;
}

interface Row {
  id: string;
  customerId: string;
  [k: string]: unknown;
}

/**
 * Re-key one tenant's rows from `oldId` to `newId` across every collection, in place. Edits the
 * raw JSON arrays (never deletes), so figure blobs keyed by figure id are untouched. Idempotent:
 * a row already owned by `newId` is left alone, so a re-run changes nothing.
 */
export async function rekeyCustomer(opts: RekeyOptions): Promise<RekeySummary> {
  const changed = {} as Record<CollectionName, number>;
  for (const { file, remapId } of COLLECTIONS) {
    const name = file.replace('.json', '') as CollectionName;
    const path = join(opts.dataDir, file);
    if (!existsSync(path)) {
      changed[name] = 0;
      continue;
    }
    const rows = JSON.parse(await readFile(path, 'utf8')) as Row[];
    let count = 0;
    for (const row of rows) {
      if (row.customerId === opts.oldId) {
        row.customerId = opts.newId;
        if (remapId) row.id = opts.newId;
        count++;
      }
    }
    changed[name] = count;
    if (!opts.dryRun && count > 0) {
      // Match JsonCollection's on-disk format (2-space pretty print).
      await writeFile(path, JSON.stringify(rows, null, 2), 'utf8');
    }
  }
  return { changed };
}

/** Recursively copy the data dir to a timestamped sibling. Returns the backup path. */
export async function backupDataDir(dataDir: string, stampIso: string): Promise<string> {
  const stamp = stampIso.replace(/[:.]/g, '-');
  const dest = `${dataDir}.backup-${stamp}`;
  await cp(dataDir, dest, { recursive: true });
  return dest;
}

// ---- CLI -------------------------------------------------------------------
// Usage:
//   QB_DATA_DIR=/data \
//   npx tsx packages/server/src/scripts/rekey-customer.ts --old <OLD_ID> --new <NEW_SUB> [--dry-run]
function parseArgs(argv: string[]): { oldId?: string; newId?: string; dryRun: boolean } {
  const out: { oldId?: string; newId?: string; dryRun: boolean } = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--old') out.oldId = argv[++i];
    else if (argv[i] === '--new') out.newId = argv[++i];
    else if (argv[i] === '--dry-run') out.dryRun = true;
  }
  return out;
}

async function main(): Promise<void> {
  const { oldId, newId, dryRun } = parseArgs(process.argv.slice(2));
  const dataDir = process.env.QB_DATA_DIR;
  if (!dataDir || !oldId || !newId) {
    throw new Error('Required: QB_DATA_DIR env, --old <id>, --new <sub>');
  }

  // Verify pre-counts.
  const before = await rekeyCustomer({ dataDir, oldId, newId, dryRun: true });
  console.log('Rows to re-key:', before.changed);

  if (dryRun) {
    console.log('Dry run — no changes written.');
    return;
  }

  const backup = await backupDataDir(dataDir, new Date().toISOString());
  console.log('Backed up data dir to:', backup);

  const result = await rekeyCustomer({ dataDir, oldId, newId });
  console.log('Re-keyed:', result.changed);

  // Verify post-counts: nothing left under oldId, and newId now holds what oldId did.
  const leftover = await rekeyCustomer({ dataDir, oldId, newId, dryRun: true });
  const ok = Object.values(leftover.changed).every((n) => n === 0);
  console.log(ok ? 'Verified: no rows remain under the old id.' : 'WARNING: rows still under old id!');
  if (!ok) throw new Error('Re-key verification failed — restore from backup.');
}

const isEntry = process.argv[1]?.endsWith('rekey-customer.ts');
if (isEntry) {
  void main();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project server packages/server/src/scripts/rekey-customer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`
Expected: PASS.
```bash
git add packages/server/src/scripts/rekey-customer.ts packages/server/src/scripts/rekey-customer.test.ts
git commit -m "feat(server): add idempotent sub re-key migration script"
```

---

# Phase 4 — Client auth module

### Task 4.1: Add `@qb/auth-config` to the client + runtime config

**Files:** Modify `packages/client/package.json`, `packages/client/tsconfig.json`, `packages/client/vite.config.ts`; create `packages/client/src/lib/auth/config.ts`

- [ ] **Step 1: Add the dependency**

Edit `packages/client/package.json` `dependencies`:
```json
  "dependencies": {
    "@qb/auth-config": "*",
    "katex": "^0.16.22",
    "navigo": "^8.11.1"
  }
```

- [ ] **Step 2: Reference it from the client tsconfig**

Edit `packages/client/tsconfig.json` — add a project reference (path alias `@qb/auth-config` resolves via Bundler resolution through the workspace symlink + the vite alias below):
```json
  "references": [{ "path": "../auth-config" }],
```
Add this key at the top level of the JSON (sibling to `compilerOptions`/`include`).

- [ ] **Step 3: Add the vite alias**

Edit `packages/client/vite.config.ts` `resolve.alias`:
```ts
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@qb/auth-config': path.resolve(__dirname, '../auth-config/src/index.ts'),
    },
  },
```

- [ ] **Step 4: Write the runtime config helper**

The single QB image serves both beta and prod, so the SPA picks its authority by hostname at runtime (not build time).

`packages/client/src/lib/auth/config.ts`:
```ts
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
```

- [ ] **Step 5: Install + typecheck + commit**

Run: `cd /home/oliver/projects/QuestionBank && npm install && npm run typecheck`
Expected: PASS.
```bash
git add packages/client/package.json packages/client/tsconfig.json packages/client/vite.config.ts packages/client/src/lib/auth/config.ts package-lock.json
git commit -m "feat(client): wire @qb/auth-config and runtime auth config"
```

---

### Task 4.2: PKCE primitives

**Files:**
- Create: `packages/client/src/lib/auth/pkce.ts`
- Test: `packages/client/tests/unit/lib/auth/pkce.test.ts`

- [ ] **Step 1: Write the failing test (RFC 7636 vector)**

`packages/client/tests/unit/lib/auth/pkce.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { challengeFromVerifier, generateState, generateVerifier } from '@/lib/auth/pkce';

describe('pkce', () => {
  test('challengeFromVerifier matches the RFC 7636 test vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = await challengeFromVerifier(verifier);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  test('generateVerifier returns a url-safe string of usable length', () => {
    const v = generateVerifier();
    expect(v).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(v.length).toBeGreaterThanOrEqual(43);
  });

  test('generateState returns a url-safe random string', () => {
    expect(generateState()).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(generateState()).not.toBe(generateState());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project client packages/client/tests/unit/lib/auth/pkce.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pkce.ts`**

`packages/client/src/lib/auth/pkce.ts`:
```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project client packages/client/tests/unit/lib/auth/pkce.test.ts`
Expected: PASS (3 tests). If `crypto.subtle` is undefined under jsdom, the test runner exposes Node's global webcrypto — confirm Node ≥20 (it is, per `engines`).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/lib/auth/pkce.ts packages/client/tests/unit/lib/auth/pkce.test.ts
git commit -m "feat(client): add PKCE verifier/challenge/state primitives"
```

---

### Task 4.3: Token + PKCE/return-to storage

**Files:**
- Create: `packages/client/src/lib/auth/storage.ts`
- Test: `packages/client/tests/unit/lib/auth/storage.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/client/tests/unit/lib/auth/storage.test.ts`:
```ts
import { afterEach, describe, expect, test } from 'vitest';
import {
  clearTokens, loadFlow, loadTokens, saveFlow, saveTokens, takeFlow,
} from '@/lib/auth/storage';

afterEach(() => sessionStorage.clear());

describe('token storage', () => {
  test('round-trips a token set', () => {
    const tokens = { accessToken: 'a', refreshToken: 'r', expiresAt: 123 };
    saveTokens(tokens);
    expect(loadTokens()).toEqual(tokens);
  });

  test('clearTokens removes them', () => {
    saveTokens({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 });
    clearTokens();
    expect(loadTokens()).toBeNull();
  });

  test('loadTokens returns null when absent', () => {
    expect(loadTokens()).toBeNull();
  });
});

describe('flow storage (PKCE + return-to)', () => {
  test('saveFlow / loadFlow round-trips', () => {
    saveFlow({ verifier: 'v', state: 's', returnTo: '/x' });
    expect(loadFlow()).toEqual({ verifier: 'v', state: 's', returnTo: '/x' });
  });

  test('takeFlow returns then clears', () => {
    saveFlow({ verifier: 'v', state: 's', returnTo: '/x' });
    expect(takeFlow()?.state).toBe('s');
    expect(loadFlow()).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project client packages/client/tests/unit/lib/auth/storage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `storage.ts`**

`packages/client/src/lib/auth/storage.ts`:
```ts
const TOKENS_KEY = 'qb.auth.tokens';
const FLOW_KEY = 'qb.auth.flow';

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Absolute expiry in epoch milliseconds. */
  expiresAt: number;
}

/** Transient state persisted across the authorize redirect. */
export interface AuthFlow {
  verifier: string;
  state: string;
  returnTo: string;
}

export function saveTokens(tokens: TokenSet): void {
  sessionStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
}

export function loadTokens(): TokenSet | null {
  const raw = sessionStorage.getItem(TOKENS_KEY);
  return raw ? (JSON.parse(raw) as TokenSet) : null;
}

export function clearTokens(): void {
  sessionStorage.removeItem(TOKENS_KEY);
}

export function saveFlow(flow: AuthFlow): void {
  sessionStorage.setItem(FLOW_KEY, JSON.stringify(flow));
}

export function loadFlow(): AuthFlow | null {
  const raw = sessionStorage.getItem(FLOW_KEY);
  return raw ? (JSON.parse(raw) as AuthFlow) : null;
}

/** Read and remove the flow (single-use after callback). */
export function takeFlow(): AuthFlow | null {
  const flow = loadFlow();
  sessionStorage.removeItem(FLOW_KEY);
  return flow;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project client packages/client/tests/unit/lib/auth/storage.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/lib/auth/storage.ts packages/client/tests/unit/lib/auth/storage.test.ts
git commit -m "feat(client): add auth token and flow storage"
```

---

### Task 4.4: OIDC discovery (cached)

**Files:**
- Create: `packages/client/src/lib/auth/discovery.ts`
- Test: `packages/client/tests/unit/lib/auth/discovery.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/client/tests/unit/lib/auth/discovery.test.ts`:
```ts
import { afterEach, describe, expect, test, vi } from 'vitest';
import { discover, resetDiscoveryCache } from '@/lib/auth/discovery';

const DOC = {
  issuer: 'https://auth.test/application/o/questionbank/',
  authorization_endpoint: 'https://auth.test/application/o/authorize/',
  token_endpoint: 'https://auth.test/application/o/token/',
  jwks_uri: 'https://auth.test/application/o/questionbank/jwks/',
  end_session_endpoint: 'https://auth.test/application/o/questionbank/end-session/',
};

afterEach(() => {
  resetDiscoveryCache();
  vi.unstubAllGlobals();
});

describe('discover', () => {
  test('fetches and returns the discovery document', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(DOC), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const doc = await discover('https://auth.test/application/o/questionbank/');
    expect(doc.token_endpoint).toBe(DOC.token_endpoint);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test('caches per authority — second call does not refetch', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(DOC), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await discover('https://auth.test/application/o/questionbank/');
    await discover('https://auth.test/application/o/questionbank/');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project client packages/client/tests/unit/lib/auth/discovery.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `discovery.ts`**

`packages/client/src/lib/auth/discovery.ts`:
```ts
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

/** Test-only: clear the discovery cache. */
export function resetDiscoveryCache(): void {
  cache.clear();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project client packages/client/tests/unit/lib/auth/discovery.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/lib/auth/discovery.ts packages/client/tests/unit/lib/auth/discovery.test.ts
git commit -m "feat(client): add cached OIDC discovery"
```

---

### Task 4.5: OIDC flow (`login`/`handleCallback`/`refresh`/`getAccessToken`/`logout`)

**Files:**
- Create: `packages/client/src/lib/auth/oidc.ts`
- Test: `packages/client/tests/unit/lib/auth/oidc.test.ts`

> `login()` and `handleCallback()` touch `window.location`, which jsdom makes hard to assign. Keep the URL builder pure (`buildAuthorizeUrl`) and the token exchange testable (`exchangeCode`, `refresh`); unit-test those. `login()`/`handleCallback()` are thin orchestrators over them plus `window.location` and are exercised by manual verification during cutover.

- [ ] **Step 1: Write the failing test**

`packages/client/tests/unit/lib/auth/oidc.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildAuthorizeUrl, exchangeCode, getAccessToken, refresh } from '@/lib/auth/oidc';
import { resetDiscoveryCache } from '@/lib/auth/discovery';
import { clearTokens, loadTokens, saveTokens } from '@/lib/auth/storage';

const DOC = {
  issuer: 'https://auth.test/application/o/questionbank/',
  authorization_endpoint: 'https://auth.test/application/o/authorize/',
  token_endpoint: 'https://auth.test/application/o/token/',
  jwks_uri: 'https://auth.test/jwks/',
};

beforeEach(() => {
  resetDiscoveryCache();
  clearTokens();
});
afterEach(() => vi.unstubAllGlobals());

describe('buildAuthorizeUrl', () => {
  test('includes PKCE + required params', () => {
    const url = new URL(
      buildAuthorizeUrl(DOC.authorization_endpoint, {
        clientId: 'questionbank',
        redirectUri: 'https://app.test/auth/callback',
        scopes: 'openid profile email',
        state: 'st',
        challenge: 'ch',
      }),
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('questionbank');
    expect(url.searchParams.get('code_challenge')).toBe('ch');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/auth/callback');
  });
});

describe('exchangeCode', () => {
  test('POSTs the code + verifier and stores tokens', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = typeof input === 'string' ? input : input.toString();
      if (u.endsWith('openid-configuration')) return new Response(JSON.stringify(DOC), { status: 200 });
      return new Response(
        JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 300 }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await exchangeCode('https://auth.test/application/o/questionbank/', {
      code: 'c', verifier: 'v', clientId: 'questionbank', redirectUri: 'https://app.test/auth/callback',
    });

    const tokens = loadTokens();
    expect(tokens?.accessToken).toBe('AT');
    expect(tokens?.refreshToken).toBe('RT');
    expect(tokens?.expiresAt).toBeGreaterThan(0);
  });
});

describe('getAccessToken', () => {
  test('returns a stored unexpired token without refreshing', async () => {
    saveTokens({ accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 60_000 });
    expect(await getAccessToken('https://auth.test/application/o/questionbank/', 'questionbank')).toBe('AT');
  });

  test('returns null when there is no token', async () => {
    expect(await getAccessToken('https://auth.test/application/o/questionbank/', 'questionbank')).toBeNull();
  });
});

describe('refresh', () => {
  test('exchanges the refresh token and updates storage', async () => {
    saveTokens({ accessToken: 'old', refreshToken: 'RT', expiresAt: Date.now() - 1 });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = typeof input === 'string' ? input : input.toString();
      if (u.endsWith('openid-configuration')) return new Response(JSON.stringify(DOC), { status: 200 });
      return new Response(
        JSON.stringify({ access_token: 'new', refresh_token: 'RT2', expires_in: 300 }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const token = await refresh('https://auth.test/application/o/questionbank/', 'questionbank');
    expect(token).toBe('new');
    expect(loadTokens()?.refreshToken).toBe('RT2');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project client packages/client/tests/unit/lib/auth/oidc.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `oidc.ts`**

`packages/client/src/lib/auth/oidc.ts`:
```ts
import { authConfig } from './config.js';
import { discover } from './discovery.js';
import { challengeFromVerifier, generateState, generateVerifier } from './pkce.js';
import {
  clearTokens, loadTokens, saveFlow, saveTokens, takeFlow, type TokenSet,
} from './storage.js';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

/** Refresh this many ms before expiry to avoid racing the clock. */
const EXPIRY_SKEW_MS = 30_000;

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  scopes: string;
  state: string;
  challenge: string;
}

/** Build the authorize URL (pure). */
export function buildAuthorizeUrl(endpoint: string, p: AuthorizeParams): string {
  const url = new URL(endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', p.clientId);
  url.searchParams.set('redirect_uri', p.redirectUri);
  url.searchParams.set('scope', p.scopes);
  url.searchParams.set('state', p.state);
  url.searchParams.set('code_challenge', p.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

function storeFromResponse(json: TokenResponse): TokenSet {
  const tokens: TokenSet = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  saveTokens(tokens);
  return tokens;
}

/** Begin auth-code + PKCE: persist the flow, then redirect to Authentik. */
export async function login(returnTo: string = window.location.href): Promise<void> {
  const cfg = authConfig();
  const doc = await discover(cfg.authority);
  const verifier = generateVerifier();
  const state = generateState();
  saveFlow({ verifier, state, returnTo });
  const challenge = await challengeFromVerifier(verifier);
  window.location.assign(
    buildAuthorizeUrl(doc.authorization_endpoint, {
      clientId: cfg.clientId,
      redirectUri: cfg.redirectUri,
      scopes: cfg.scopes,
      state,
      challenge,
    }),
  );
}

export interface ExchangeParams {
  code: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
}

/** Exchange an authorization code for tokens and store them. */
export async function exchangeCode(authority: string, p: ExchangeParams): Promise<TokenSet> {
  const doc = await discover(authority);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: p.code,
    redirect_uri: p.redirectUri,
    client_id: p.clientId,
    code_verifier: p.verifier,
  });
  const res = await fetch(doc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  return storeFromResponse((await res.json()) as TokenResponse);
}

/**
 * Handle the redirect back from Authentik: validate state, exchange the code, then return the
 * location to resume. Throws on state mismatch or a missing flow.
 */
export async function handleCallback(): Promise<string> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const flow = takeFlow();
  if (!flow) throw new Error('no auth flow in progress');
  if (!code || state !== flow.state) throw new Error('auth callback state mismatch');
  const cfg = authConfig();
  await exchangeCode(cfg.authority, {
    code,
    verifier: flow.verifier,
    clientId: cfg.clientId,
    redirectUri: cfg.redirectUri,
  });
  return flow.returnTo;
}

/** Exchange the stored refresh token for a fresh access token. Returns null if not possible. */
export async function refresh(authority: string, clientId: string): Promise<string | null> {
  const tokens = loadTokens();
  if (!tokens?.refreshToken) return null;
  const doc = await discover(authority);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: clientId,
  });
  const res = await fetch(doc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    clearTokens();
    return null;
  }
  return storeFromResponse((await res.json()) as TokenResponse).accessToken;
}

/** A valid access token, refreshing if expired. Null if the user must log in again. */
export async function getAccessToken(
  authority: string = authConfig().authority,
  clientId: string = authConfig().clientId,
): Promise<string | null> {
  const tokens = loadTokens();
  if (!tokens) return null;
  if (Date.now() < tokens.expiresAt - EXPIRY_SKEW_MS) return tokens.accessToken;
  return refresh(authority, clientId);
}

/** Clear local tokens and redirect to Authentik's end-session endpoint if present. */
export async function logout(): Promise<void> {
  const cfg = authConfig();
  clearTokens();
  const doc = await discover(cfg.authority);
  if (doc.end_session_endpoint) {
    window.location.assign(doc.end_session_endpoint);
  } else {
    window.location.assign('/');
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project client packages/client/tests/unit/lib/auth/oidc.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/lib/auth/oidc.ts packages/client/tests/unit/lib/auth/oidc.test.ts
git commit -m "feat(client): add OIDC auth-code+PKCE flow"
```

---

### Task 4.6: `authFetch` wrapper + 401 hook seam

**Files:**
- Create: `packages/client/src/lib/auth/auth-fetch.ts`
- Test: `packages/client/tests/unit/lib/auth/auth-fetch.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/client/tests/unit/lib/auth/auth-fetch.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { authFetch, onUnauthorized } from '@/lib/auth/auth-fetch';
import { resetDiscoveryCache } from '@/lib/auth/discovery';
import { clearTokens, saveTokens } from '@/lib/auth/storage';

beforeEach(() => {
  resetDiscoveryCache();
  clearTokens();
});
afterEach(() => vi.unstubAllGlobals());

describe('authFetch', () => {
  test('attaches the bearer token', async () => {
    saveTokens({ accessToken: 'AT', refreshToken: null, expiresAt: Date.now() + 60_000 });
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await authFetch('/api/books');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer AT');
  });

  test('fires the onUnauthorized hook on a 401', async () => {
    saveTokens({ accessToken: 'AT', refreshToken: null, expiresAt: Date.now() + 60_000 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    const hook = vi.fn();
    onUnauthorized(hook);

    const res = await authFetch('/api/books');
    expect(res.status).toBe(401);
    expect(hook).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project client packages/client/tests/unit/lib/auth/auth-fetch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `auth-fetch.ts`**

`packages/client/src/lib/auth/auth-fetch.ts`:
```ts
import { getAccessToken } from './oidc.js';

type UnauthorizedHook = () => void;
let unauthorizedHook: UnauthorizedHook | null = null;

/**
 * Register a callback fired whenever an API response is 401. Seam for Project C
 * (redirect-to-relogin). No-op until something registers a hook.
 */
export function onUnauthorized(hook: UnauthorizedHook): void {
  unauthorizedHook = hook;
}

/** `fetch` wrapper that attaches the bearer token and surfaces 401s to the hook. */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) unauthorizedHook?.();
  return res;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project client packages/client/tests/unit/lib/auth/auth-fetch.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Create the barrel + commit**

`packages/client/src/lib/auth/index.ts`:
```ts
export { authConfig, currentEnv, type ClientAuthConfig } from './config.js';
export { getAccessToken, handleCallback, login, logout, refresh } from './oidc.js';
export { authFetch, onUnauthorized } from './auth-fetch.js';
export { clearTokens, loadTokens } from './storage.js';
```
Run: `npm run typecheck`
Expected: PASS.
```bash
git add packages/client/src/lib/auth/auth-fetch.ts packages/client/tests/unit/lib/auth/auth-fetch.test.ts packages/client/src/lib/auth/index.ts
git commit -m "feat(client): add authFetch wrapper and 401 hook seam"
```

---

# Phase 5 — Client wiring

### Task 5.1: Callback page + bootstrap

**Files:** Create `packages/client/src/pages/AuthCallbackPage.ts`; modify `packages/client/src/main.ts`

> The redirect URI is the real path `/auth/callback` (no hash), served by the server's SPA fallback. navigo is hash-based, so the callback is handled in bootstrap (before the router resolves), not as a navigo route.

- [ ] **Step 1: Create the callback view**

`packages/client/src/pages/AuthCallbackPage.ts`:
```ts
import { html } from '@/lib/html';

/** Minimal "signing in" view shown while the callback exchange runs. */
export function AuthCallbackPage(): HTMLElement {
  return html`<main class="auth-callback"><p>Signing you in…</p></main>`;
}
```

- [ ] **Step 2: Rewrite the bootstrap in `main.ts`**

Replace the router setup section of `packages/client/src/main.ts` (everything from `const app = ...` to the final `.resolve();`) with a bootstrap that handles the callback and gates on a token. Keep all the existing page imports and the CSS imports at the top; add the auth + callback imports.

Add imports:
```ts
import { getAccessToken, handleCallback, login } from '@/lib/auth';
import { AuthCallbackPage } from '@/pages/AuthCallbackPage';
```

Replace the router/resolve block with:
```ts
const app = document.getElementById('app')!;

function mount(page: () => HTMLElement): void {
  app.replaceChildren(page());
}

function setupRouter(): void {
  const router = new Navigo('/', { hash: true });
  router
    .on('/', () => mount(LandingPage))
    .on('/add-book', () => mount(AddBookPage))
    .on('/scan-problems', () => mount(ScanProblemsPage))
    .on('/figure-scan', () => mount(FigureScanPage))
    .on('/manage-books', () => mount(ManageBooksPage))
    .on('/edit-book', () => mount(EditBookPage))
    .on('/view-book', () => mount(ViewBookPage))
    .on('/attempts', () => mount(AttemptsPage))
    .on('/learn', () => mount(LearnPage))
    .on('/revisit', () => mount(RevisitPage))
    .on('/grade', () => mount(GradePage))
    .on('/settings', () => mount(SettingsPage))
    .resolve();
}

async function bootstrap(): Promise<void> {
  // 1. OIDC redirect landing: exchange the code, then resume at a clean URL.
  if (window.location.pathname === '/auth/callback') {
    mount(AuthCallbackPage);
    try {
      const returnTo = await handleCallback();
      // Replace so the back button never returns to the callback URL.
      window.location.replace(returnTo || '/');
    } catch {
      await login('/'); // state mismatch / no flow → restart login
    }
    return;
  }

  // 2. Normal load: require a token, else start login (redirects away).
  const token = await getAccessToken();
  if (!token) {
    await login();
    return;
  }

  // 3. Authenticated: render the app.
  setupRouter();
}

void bootstrap();
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm --workspace @qb/client run build`
Expected: PASS / build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/pages/AuthCallbackPage.ts packages/client/src/main.ts
git commit -m "feat(client): handle OIDC callback and gate app on a token"
```

---

### Task 5.2: Route all API calls through `authFetch`

> Replace raw `fetch('/api/...')` with `authFetch` everywhere the SPA calls the API. The XHR upload path in `ScanProblemsPage` needs the bearer set manually.

**Files:** Modify `packages/client/src/pages/grade/grade-api.ts`, `pages/LandingPage.ts`, `pages/SettingsPage.ts`, `pages/ScanProblemsPage.ts`, and any other page calling `/api/*` (find them in Step 1).

- [ ] **Step 1: Enumerate every API fetch site**

Run:
```bash
cd /home/oliver/projects/QuestionBank
grep -rn "fetch(\`*['\"\`]/api\|fetch('/api\|fetch(\"/api\|fetch(\`/api" packages/client/src
grep -rn "XMLHttpRequest\|\.open('POST'\|\.open(\"POST\"" packages/client/src
```
Expected: a list of files. Update each per Steps 2–3.

- [ ] **Step 2: Replace `fetch` with `authFetch` in each file**

In every file that calls `fetch('/api/...')` (e.g. `grade-api.ts`, `LandingPage.ts`, `SettingsPage.ts`), add at the top:
```ts
import { authFetch } from '@/lib/auth';
```
and change each `fetch(` call that targets `/api/...` to `authFetch(` (leave non-API fetches untouched). Example, `grade-api.ts`:
```ts
const res = await authFetch(`/api/questions/${questionId}/transcribe`, { method: 'POST', body: form });
```
`LandingPage.ts`:
```ts
const [activity, books] = await Promise.all([
  authFetch('/api/activity').then((r) => r.json() as Promise<Activity>).catch(() => null),
  authFetch('/api/books/summaries').then((r) => r.json() as Promise<BookWithSummary[]>).catch(() => [] as BookWithSummary[]),
]);
```

- [ ] **Step 3: Set the bearer on the XHR upload path**

In `packages/client/src/pages/ScanProblemsPage.ts`, the `postWithProgress` helper uses `XMLHttpRequest`. Make it attach the token. Add the import:
```ts
import { getAccessToken } from '@/lib/auth';
```
Make `postWithProgress` async and set the header after `xhr.open`:
```ts
async function postWithProgress(url: string, form: FormData, onUploaded: () => void): Promise<unknown> {
  const token = await getAccessToken();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    // ...rest unchanged...
  });
}
```
Update its call sites to `await postWithProgress(...)` if they weren't already awaiting.

- [ ] **Step 4: Verify no raw API fetches remain**

Run:
```bash
grep -rn "[^h]fetch('/api\|[^h]fetch(\"/api\|[^h]fetch(\`/api" packages/client/src
```
Expected: no output (all converted to `authFetch`).

- [ ] **Step 5: Run client tests + typecheck + build**

Run: `npm run test:client && npm run typecheck && npm --workspace @qb/client run build`
Expected: PASS. (Existing page tests that `vi.stubGlobal('fetch', ...)` still work — `authFetch` calls global `fetch` under the hood; with no token stored it simply omits the Authorization header.)

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/pages
git commit -m "feat(client): send bearer token on all API calls via authFetch"
```

---

# Phase 6 — Beta smoke tests via machine client

### Task 6.1: Authenticate the smoke suite with a client-credentials token

**Files:** Modify `packages/server/tests/beta/smoke.beta.test.ts`

- [ ] **Step 1: Add a token fetch + replace the header helper**

In `packages/server/tests/beta/smoke.beta.test.ts`:
- Read the machine-client credentials and authority from env near the existing `BASE_URL`/`UID` block:
```ts
const TOKEN_URL = process.env.QB_BETA_OIDC_TOKEN_URL; // e.g. https://auth-beta.ovea.pro/application/o/token/
const CLIENT_ID = process.env.QB_BETA_OIDC_CLIENT_ID;
const CLIENT_SECRET = process.env.QB_BETA_OIDC_CLIENT_SECRET;
if (!TOKEN_URL || !CLIENT_ID || !CLIENT_SECRET) {
  throw new Error(
    'Beta smoke needs QB_BETA_OIDC_TOKEN_URL, QB_BETA_OIDC_CLIENT_ID, QB_BETA_OIDC_CLIENT_SECRET ' +
      '(the machine client used to obtain a bearer token).',
  );
}
```
- Fetch the token once (cached for the run), before the suite uses it:
```ts
let bearer = '';
async function getBearer(): Promise<string> {
  if (bearer) return bearer;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID!,
    client_secret: CLIENT_SECRET!,
    scope: 'openid',
  });
  const res = await fetch(TOKEN_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`client-credentials token request failed: ${res.status}`);
  bearer = `Bearer ${((await res.json()) as { access_token: string }).access_token}`;
  return bearer;
}
```
- Replace the `authed()` helper so it stamps the bearer instead of `X-authentik-uid`:
```ts
function authed(method: 'get' | 'post' | 'put' | 'delete', path: string) {
  return agent[method](path).set('Authorization', bearer);
}
```
- Ensure `bearer` is populated before the first authed request. Add a top-level guard test or a `beforeAll`:
```ts
beforeAll(async () => {
  await getBearer();
});
```
(import `beforeAll` from `vitest`.)
- The "strict mode" test that asserts an unauthenticated request 401s: change it to send no Authorization header (it already does — it uses the raw `agent`, not `authed`). Keep it.
- Remove the now-unused `UID` constant.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (The beta suite is excluded from `npm test`; it only runs via `npm run test:beta` with env set — do not run it here, there is no live token locally.)

- [ ] **Step 3: Commit**

```bash
git add packages/server/tests/beta/smoke.beta.test.ts
git commit -m "test(beta): authenticate smoke suite with a machine-client token"
```

---

### Task 6.2: Pipeline secrets + env for the smoke run

**Files:** Modify `.pipelines/config.yaml`, `.pipelines/scripts/test-after-beta.sh`

- [ ] **Step 1: Declare the machine-client secrets in the pipeline**

In `.pipelines/config.yaml`, add to the pipeline secrets list (mirroring how `ANTHROPIC_API_KEY` etc. are declared by name):
```yaml
  - QB_BETA_OIDC_CLIENT_ID
  - QB_BETA_OIDC_CLIENT_SECRET
```
(Set their values out-of-band via the pipeline secrets API after the Authentik machine client exists — see Phase 8 / cutover.)

- [ ] **Step 2: Pass the token env into the smoke run**

In `.pipelines/scripts/test-after-beta.sh`, where it currently runs `QB_BETA_BASE_URL="$BASE" npm run test:beta`, add the OIDC env:
```bash
QB_BETA_BASE_URL="$BASE" \
QB_BETA_OIDC_TOKEN_URL="https://auth-beta.ovea.pro/application/o/token/" \
QB_BETA_OIDC_CLIENT_ID="$QB_BETA_OIDC_CLIENT_ID" \
QB_BETA_OIDC_CLIENT_SECRET="$QB_BETA_OIDC_CLIENT_SECRET" \
  npm run test:beta
```

- [ ] **Step 3: Commit**

```bash
git add .pipelines/config.yaml .pipelines/scripts/test-after-beta.sh
git commit -m "ci(beta): provide machine-client token env to the smoke suite"
```

---

# Phase 7 — Skill doc

### Task 7.1: Update the `calling-the-questionbank-api` skill

**Files:** Modify `.claude/skills/calling-the-questionbank-api/SKILL.md`

- [ ] **Step 1: Rewrite the auth section**

Replace section 2 ("Authenticate (the tenant header)") so it documents the bearer-token flow instead of `X-authentik-uid`:
- The beta API now validates Authentik JWTs; there is no identity header.
- To call it, obtain a token from the beta machine client via client-credentials:
```bash
TOKEN=$(curl -s -X POST https://auth-beta.ovea.pro/application/o/token/ \
  -d grant_type=client_credentials \
  -d client_id="$QB_BETA_OIDC_CLIENT_ID" \
  -d client_secret="$QB_BETA_OIDC_CLIENT_SECRET" \
  -d scope=openid | jq -r .access_token)
curl -s http://localhost:8088/api/books -H "Authorization: Bearer $TOKEN"
```
- The token's `sub` is the isolated tenant for that machine client (replaces the `pipeline-smoke` tenant).
- Keep the port-forward instructions (section 1) — reachability is unchanged; only auth changed.

- [ ] **Step 2: Update the gotchas and quick-reference**

- Update every `-H "X-authentik-uid: ..."` example in the endpoint-surface section to `-H "Authorization: Bearer $TOKEN"`.
- Keep the two standing gotchas (LLM-route 401 on the Anthropic key; SPA-HTML-fallback meaning route-not-deployed). Add a third note: a `401` on an `/api/*` route now also means an expired/invalid token — re-fetch.
- Update the quick-reference table's auth row from the header to the token command.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/calling-the-questionbank-api/SKILL.md
git commit -m "docs(skill): document bearer-token auth for the QB API"
```

---

# Phase 8 — Authentik blueprints (homelab repo, ArgoCD-owned)

> Repo: `/home/oliver/projects/homelab`. Blueprints deploy via ArgoCD (push to `main`; no PRs per the homelab GitOps convention). Mirror the existing `olve-template-api` OAuth2 provider structure, but the SPA client is **public + PKCE** with redirect URIs. The beta machine client is a separate **confidential** client (client-credentials), mirroring `olve-pipelines`. Both providers' tokens must carry `aud: questionbank` so the API's single audience check accepts them.

### Task 8.1: Beta — questionbank OAuth2 provider, app, and machine client

**Files:** Modify `homelab/infra/authentik/beta/blueprints/applications.yaml`

- [ ] **Step 1: Add the public SPA OAuth2 provider + application**

Append to the beta `applications.yaml` entries (adapt `!Find`/`!KeyOf`/flow slugs to the exact ones already used in this file — copy them from the existing `olve-template-api-provider` block in the same file):
```yaml
      - model: authentik_providers_oauth2.oauth2provider
        id: questionbank-oidc-provider
        identifiers:
          name: questionbank-oidc-provider
        attrs:
          authorization_flow: !Find [authentik_flows.flow, [slug, default-provider-authorization-implicit-consent]]
          invalidation_flow: !Find [authentik_flows.flow, [slug, default-provider-invalidation-flow]]
          client_type: public
          client_id: questionbank
          redirect_uris:
            - https://questionbank-beta.ovea.pro/auth/callback
            # Loopback for the future CLI (Project B); harmless to register now.
            - http://localhost:8765/callback
          signing_key: !Find [authentik_crypto.certificatekeypair, [name, authentik Self-signed Certificate]]
          # Enable the device-code grant for the CLI (Project B). Verify the exact attr name
          # against this Authentik version's oauth2provider schema before applying.
          # (e.g. `sub_mode`/`include_claims_in_id_token` defaults are fine.)
          property_mappings:
            - !Find [authentik_providers_oauth2.scopemapping, [scope_name, openid]]
            - !Find [authentik_providers_oauth2.scopemapping, [scope_name, email]]
            - !Find [authentik_providers_oauth2.scopemapping, [scope_name, profile]]

      - model: authentik_core.application
        id: questionbank-oidc-app
        identifiers:
          slug: questionbank
        attrs:
          name: Question Bank
          provider: !KeyOf questionbank-oidc-provider
          meta_launch_url: https://questionbank-beta.ovea.pro
```
> Note: the existing forward-auth `questionbank-proxy-provider` and its application stay for now (retired at cutover, Task 10.x). If the existing app slug is `questionbank` and collides, give the new app a distinct slug (e.g. `questionbank-oidc`) — the OIDC issuer path is the *provider* application slug, so set it to match `AUTHORITIES.beta` (`.../application/o/questionbank/`). Confirm the issuer path the provider exposes via the discovery doc in Step 4 and reconcile `@qb/auth-config` if it differs.

- [ ] **Step 2: Add the beta machine client (client-credentials) with aud mapping**

```yaml
      # Audience mapping so machine-client tokens carry aud: questionbank (the API audience).
      - model: authentik_providers_oauth2.scopemapping
        id: questionbank-aud-scope
        identifiers:
          name: questionbank-audience
        attrs:
          scope_name: questionbank-aud
          expression: |
            return {"aud": "questionbank"}

      - model: authentik_providers_oauth2.oauth2provider
        id: questionbank-smoke-provider
        identifiers:
          name: questionbank-smoke
        attrs:
          authorization_flow: !Find [authentik_flows.flow, [slug, default-provider-authorization-implicit-consent]]
          invalidation_flow: !Find [authentik_flows.flow, [slug, default-provider-invalidation-flow]]
          client_type: confidential
          client_id: questionbank-smoke
          client_secret: !Env QUESTIONBANK_SMOKE_OIDC_CLIENT_SECRET
          redirect_uris: []
          signing_key: !Find [authentik_crypto.certificatekeypair, [name, authentik Self-signed Certificate]]
          property_mappings:
            - !Find [authentik_providers_oauth2.scopemapping, [scope_name, openid]]
            - !KeyOf questionbank-aud-scope

      - model: authentik_core.application
        id: questionbank-smoke-app
        identifiers:
          slug: questionbank-smoke
        attrs:
          name: Question Bank Smoke
          provider: !KeyOf questionbank-smoke-provider
```
Also add the same `questionbank-aud-scope` mapping to the SPA provider's `property_mappings` (so SPA tokens also carry `aud: questionbank`):
```yaml
            - !KeyOf questionbank-aud-scope
```

- [ ] **Step 3: Provide the machine-client secret + push**

- Add `QUESTIONBANK_SMOKE_OIDC_CLIENT_SECRET` to the beta Authentik secret source (mirror how `OLVE_PIPELINES_OIDC_CLIENT_SECRET` is provided in beta `values.yaml`/secret).
- Commit and push to `main` (homelab convention: no PR):
```bash
cd /home/oliver/projects/homelab
git add infra/authentik/beta/blueprints/applications.yaml infra/authentik/beta/values.yaml
git commit -m "feat(authentik-beta): add questionbank OIDC provider + smoke machine client"
git push origin main
```

- [ ] **Step 4: Verify after ArgoCD syncs**

```bash
# Discovery doc resolves and issuer matches @qb/auth-config AUTHORITIES.beta
curl -s https://auth-beta.ovea.pro/application/o/questionbank/.well-known/openid-configuration | jq '{issuer, jwks_uri, token_endpoint, authorization_endpoint}'

# Machine client issues a token; decode it and confirm aud + sub.
TOKEN=$(curl -s -X POST https://auth-beta.ovea.pro/application/o/token/ \
  -d grant_type=client_credentials -d client_id=questionbank-smoke \
  -d client_secret="$QUESTIONBANK_SMOKE_OIDC_CLIENT_SECRET" -d scope=openid | jq -r .access_token)
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq '{iss, aud, sub}'
```
Expected: `issuer` equals `https://auth-beta.ovea.pro/application/o/questionbank/`; the token's `aud` is `questionbank` and `sub` is the machine client's stable identifier. Record this `sub` — it is the beta smoke tenant.

---

### Task 8.2: Prod — questionbank OAuth2 provider + application

**Files:** Modify `homelab/infra/authentik/prod/blueprints/applications.yaml`

- [ ] **Step 1: Add the public SPA provider + app (prod hostnames)**

Mirror Task 8.1 Step 1 in the prod file, with the prod redirect URI and launch URL:
```yaml
          redirect_uris:
            - https://questionbank.ovea.pro/auth/callback
            - http://localhost:8765/callback
```
```yaml
          meta_launch_url: https://questionbank.ovea.pro
```
Add the `questionbank-aud-scope` mapping (Task 8.1 Step 2's scope-mapping block) to the prod file too, and include it in the provider's `property_mappings`. **Do not** add a machine client to prod (smoke tests run against beta only).

- [ ] **Step 2: Push + verify**

```bash
cd /home/oliver/projects/homelab
git add infra/authentik/prod/blueprints/applications.yaml
git commit -m "feat(authentik-prod): add questionbank OIDC provider + application"
git push origin main
```
After sync:
```bash
curl -s https://auth.ovea.pro/application/o/questionbank/.well-known/openid-configuration | jq '{issuer, jwks_uri}'
```
Expected: `issuer` equals `https://auth.ovea.pro/application/o/questionbank/` (matches `AUTHORITIES.prod`).

---

# Phase 9 — Ingress + QB deploy values

### Task 9.1: QB Helm values — swap header config for OIDC env

**Files:** Modify `helm/values-beta.yaml`, `helm/values-minimal.yaml` (QuestionBank repo)

> These files have pre-existing uncommitted edits — only touch the `config:` block; review the diff before committing and stage just these files.

- [ ] **Step 1: Beta values**

In `helm/values-beta.yaml` `config:`, remove `QB_CUSTOMER_HEADER` (and `QB_ALLOW_DEFAULT_CUSTOMER` — no longer meaningful) and add:
```yaml
  QB_OIDC_AUTHORITY: "https://auth-beta.ovea.pro/application/o/questionbank/"
  QB_OIDC_AUDIENCE: "questionbank"
```

- [ ] **Step 2: Prod values (`values-minimal.yaml` — used by the prod deploy)**

In `helm/values-minimal.yaml` `config:`, remove `QB_CUSTOMER_HEADER` / `QB_ALLOW_DEFAULT_CUSTOMER` and add:
```yaml
  QB_OIDC_AUTHORITY: "https://auth.ovea.pro/application/o/questionbank/"
  QB_OIDC_AUDIENCE: "questionbank"
```

- [ ] **Step 3: Commit (only these files)**

```bash
git add helm/values-beta.yaml helm/values-minimal.yaml
git commit -m "deploy(qb): configure OIDC authority/audience, drop header auth"
```

---

### Task 9.2: Remove forward-auth from ingress (Olve.Homelab)

**Files:** Modify `Olve.Homelab/helm/values-beta.yaml`, `helm/values-prod.yaml`

> Deferred until cutover step ordering (Phase 10) but the edit is mechanical. Removing `forwardAuthMiddleware` makes the conditional in `templates/ingress.yaml` drop the Traefik middleware annotation.

- [ ] **Step 1: Delete the forward-auth line in both files**

`helm/values-beta.yaml` — remove:
```yaml
    forwardAuthMiddleware: "infra-beta-authentik-forward-auth@kubernetescrd"
```
`helm/values-prod.yaml` — remove:
```yaml
    forwardAuthMiddleware: "infra-authentik-forward-auth@kubernetescrd"
```
Keep every other key in the `questionbank` entries (host, namespace, externalDnsTarget, clusterIssuer, tlsSecretName, cloudflareProxied).

- [ ] **Step 2: Commit (do not push yet — see cutover ordering)**

```bash
cd /home/oliver/projects/Olve.Homelab
git add helm/values-beta.yaml helm/values-prod.yaml
git commit -m "deploy(ingress): remove forward-auth from questionbank (now self-authenticating)"
```

---

# Phase 10 — Cutover runbook (big-bang, beta + prod)

> Additive-first, flip last. Each repo deploys differently; this is the ordered sequence. Do **not** push the QuestionBank app and the ingress change before Authentik exists.

### Task 10.1: Determine the re-key values (prod)

- [ ] **Step 1: Find the legacy prod customerId**

Identify the current prod tenant value (the old `X-authentik-uid`) from prod data:
```bash
# In the prod questionbank pod (namespace apps):
kubectl -n apps exec deploy/questionbank -- sh -c 'cat $QB_DATA_DIR/books.json' | jq -r '[.[].customerId] | unique'
```
Record the single legacy id as `OLD_CUSTOMER_ID`.

- [ ] **Step 2: Find the user's prod `sub`**

After Phase 8.2, log into the prod SPA once (or mint a token) and read the `sub`, or read it from the Authentik user record. Record as `NEW_SUB`.

### Task 10.2: Deploy order

- [ ] **Step 1: Authentik (already done in Phase 8)** — confirm beta + prod discovery docs resolve and tokens carry `aud: questionbank`. Proxy provider still active; nothing broken yet.

- [ ] **Step 2: Set pipeline secrets** — set `QB_BETA_OIDC_CLIENT_ID=questionbank-smoke` and `QB_BETA_OIDC_CLIENT_SECRET=<value>` via the QuestionBank pipeline secrets API (matches Task 6.2 / the Authentik machine-client secret).

- [ ] **Step 3: Ship the QuestionBank image** — push the QuestionBank branch (server `requireAuth` + SPA OIDC + new helm config, Phases 1–7, 9.1). The pipeline builds one image, deploys beta, runs the machine-client smoke suite (gates prod), then deploys prod. Confirm the beta smoke stage is green.

- [ ] **Step 4: Run the prod re-key** — once the new prod image is live (server ignores the still-attached forward-auth header and reads `sub`):
```bash
kubectl -n apps exec -it deploy/questionbank -- sh -lc \
  'npx tsx packages/server/src/scripts/rekey-customer.ts --old "<OLD_CUSTOMER_ID>" --new "<NEW_SUB>" --dry-run'
# review counts, then run for real (backs up QB_DATA_DIR first, verifies post-counts):
kubectl -n apps exec -it deploy/questionbank -- sh -lc \
  'npx tsx packages/server/src/scripts/rekey-customer.ts --old "<OLD_CUSTOMER_ID>" --new "<NEW_SUB>"'
```
> If the prod image is a slim runtime without `tsx`/sources, instead `kubectl cp` the compiled `dist` script in, or run the script from a one-off job built on the same image. Confirm `tsx` + sources exist in the image first; if not, use the compiled `dist/scripts/rekey-customer.js` via `node`.

- [ ] **Step 5: Drop forward-auth + retire the proxy provider** — push the Olve.Homelab ingress change (Task 9.2) so Traefik stops attaching forward-auth. Then retire the proxy provider from the Authentik outpost in both envs:
  - Edit `homelab/infra/authentik/{beta,prod}/blueprints/outpost.yaml` to remove the `questionbank-proxy-provider` (beta: `questionbank-beta-proxy-provider`) entry from the embedded outpost's `providers` list. Optionally remove the now-dead proxy provider + its application from `applications.yaml`.
  - Commit + push (homelab: `main`, no PR).

- [ ] **Step 6: Smoke prod** — log into `https://questionbank.ovea.pro`, confirm the OIDC redirect works, data is present (re-key succeeded), and API calls carry the bearer.

### Task 10.3: Rollback (if needed)
- Redeploy the previous QuestionBank image.
- Re-add `forwardAuthMiddleware` to `Olve.Homelab/helm/values-{beta,prod}.yaml` and re-add the proxy provider to the outposts; push.
- Restore the data backup created by the re-key script (`$QB_DATA_DIR.backup-<stamp>`).

---

## Notes on deviations from the spec (intentional, within locked decisions)
- **Callback handled in bootstrap, not as a navigo route** (§7 says "navigo route"): navigo runs in hash mode, but the redirect URI is the real path `/auth/callback`. Bootstrap-level detection is the correct way to reconcile the two; the public auth API is unchanged.
- **SPA picks its authority by hostname at runtime** rather than a build-time env: one QB image serves both beta and prod, so build-time selection is impossible. Uses `@qb/auth-config` `AUTHORITIES`.
- **`aud: questionbank` via an Authentik audience scope-mapping** for both the SPA and machine clients, so the API validates a single audience. Verify the mapping in Phase 8 Step 4 before relying on it.
- **`requireAuth` delegates the "is there a token" check to the verifier** (empty token → throw → 401) so existing route tests authenticate by injecting a permissive verifier with no per-request header churn. Production behaviour (missing/invalid → 401) is unchanged.
