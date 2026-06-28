# Project A — QuestionBank API + SPA: Authentik OIDC (replace forward-auth)

- **Date:** 2026-06-28
- **Status:** Design — awaiting user review
- **Owner:** Oliver
- **Related:** Project B (`qb` CLI, depends on this) and Project C (FE auth UX hardening — follow-up). This spec covers Project A only.

## 1. Context & motivation

We want a `qb` CLI that talks to the deployed QuestionBank API over its real
(tailscale/cloudflare) URLs. Those URLs sit behind an Authentik **forward-auth proxy**
(`questionbank-proxy-provider`): the proxy injects an `X-authentik-uid` header after a
browser SSO login, and the API trusts that header as the customer/tenant id
(`packages/server/src/middleware/resolve-customer.ts`). A non-browser client gets
bounced to the Authentik login page, so there is no programmatic auth path today.

The chosen fix is to do auth the standard, app-level way — exactly like
`olve-template-api`, which exposes its own Authentik **OAuth2 provider** and validates
bearer tokens (`AddJwtBearer`, `Authority = https://auth.ovea.pro/application/o/<app>/`).
`pl` works against real URLs for the same reason. QuestionBank will adopt that pattern:
the API becomes an OIDC resource server, the SPA logs in via the browser OIDC flow, and
forward-auth is removed. A single signature-validated token path replaces header trust.

This is the prerequisite that unblocks the CLI (Project B).

## 2. Goals / non-goals

**Goals**
- The QB API authenticates `/api/*` by validating an Authentik-issued JWT (OIDC resource
  server), resolving the token's `sub` to `req.customerId`.
- The QB SPA authenticates via the standard browser OIDC flow (authorization code + PKCE)
  and sends a bearer token on every API call.
- Forward-auth is removed from QB's ingress (beta + prod); the `X-authentik-uid`
  header-trust path is deleted from the server.
- Auth is isolated in dedicated, independently testable modules (server + client) plus a
  shared config package.
- Existing data is preserved via a one-time re-key from the old customer id to `sub`.
- Beta smoke tests authenticate with a real Authentik machine client.

**Non-goals (this project)**
- The `qb` CLI itself (Project B).
- FE auth UX hardening — token refresh, redirect-to-relogin, seamless resume (Project C).
  The client auth module will expose the seams these need, but the UX is out of scope here.
- Any change to the Python figure-service auth (it is reached server-to-server, unchanged).

## 3. Decisions (resolved)

| Decision | Choice | Rationale |
|---|---|---|
| Auth model | Replace forward-auth with app-level OIDC everywhere | Single, standard, signature-validated path; smaller attack surface |
| Cutover | Big-bang atomic (per the three repos) | Solo user → no lockout blast radius; simplest |
| Env scope | Beta **and** prod together | Solo user; one coordinated effort |
| Claim → tenant | Standard `sub` claim + one-time data re-key | Correct long-term identifier, not a header-matching hack |
| Smoke-test auth | Authentik machine client (client-credentials) | Real auth path, no test-only server bypass |
| Overarching | Do it the correct/standard way, no shortcuts | Stated user preference |

## 4. Architecture & module boundaries

Three self-contained units with narrow interfaces:

### 4.1 `@qb/auth-config` (new shared package)
Single source of truth imported by server, client, and (later) the CLI. **Config + types
only, no logic:**
- `authority` per env (beta: `https://auth-beta.ovea.pro/application/o/questionbank/`,
  prod: `https://auth.ovea.pro/application/o/questionbank/`)
- `clientId` (`questionbank`), `scopes` (`openid profile email`)
- `CUSTOMER_CLAIM = 'sub'` — the single place that names which claim is the tenant id
- Derived endpoints come from the authority's `.well-known/openid-configuration`.

Prevents the three consumers from drifting on URLs/claim names.

### 4.2 Server auth module — `packages/server/src/auth/`
Encapsulates everything JWT. Public interface:
- `verifyBearer(token: string): Promise<{ customerId: string; claims: JwtClaims }>` —
  validates signature (JWKS, cached, fetched from the authority), `iss`, `aud`, `exp`,
  `nbf`; resolves `customerId` from `CUSTOMER_CLAIM`. Implemented with `jose`.
- `requireAuth: RequestHandler` — extracts `Authorization: Bearer`, calls `verifyBearer`,
  sets `req.customerId`, 401s on missing/invalid. `/api/health` stays open (mounted before
  this middleware).

Nothing outside this module references JWTs. It **replaces** the identity-header branch in
`resolve-customer.ts`; `req.customerId` and the route contract are unchanged, so handlers
need no edits.

### 4.3 Client auth module — `packages/client/src/lib/auth/`
Encapsulates the browser OIDC flow. Public interface:
- `login()` — start auth-code + PKCE (S256): build authorize URL, persist verifier + a
  **return-to** location, redirect to Authentik.
- `handleCallback()` — exchange code → tokens, store them, restore return-to.
- `logout()` — clear tokens (and Authentik end-session).
- `getAccessToken(): Promise<string | null>` — current valid token.
- `refresh()` — refresh-token exchange.
- `authFetch(input, init)` — `fetch` wrapper attaching the bearer.

**Seams for Project C (built now, UX deferred):** `refresh()` exists; `authFetch` exposes a
401 hook; `login()` already captures return-to. Project C wires these into auto-refresh,
redirect-on-401, and resume — no rework of this module.

## 5. Authentik (homelab `infra/authentik/{beta,prod}/blueprints`, ArgoCD-owned)

- Add a `questionbank` **OAuth2 provider** mirroring `olve-template-api`:
  - Public client, **PKCE required (S256)**.
  - **Device-code flow enabled** (for Project B's CLI).
  - Redirect URIs: SPA callback (`https://questionbank.ovea.pro/auth/callback`,
    `https://questionbank-beta.ovea.pro/auth/callback`), plus CLI loopback/device.
  - Scope mappings: `openid`, `profile`, `email`.
  - An `authentik` Application bound to the provider.
- Add a **machine client** (client-credentials) for beta smoke tests, issuing a token whose
  `sub` is the disposable test tenant (mirrors the existing `MACHINE_POLICIES` pattern in
  `applications.yaml`).
- **Retire** `questionbank-proxy-provider` from the outpost (`outpost.yaml`).

## 6. Server changes (`@qb/server`)

- New `src/auth/` module (§4.2).
- `src/index.ts` / app wiring: keep `/api/health` open; mount `requireAuth` on `/api/*`.
  `requireAuth` **fully replaces** the `resolveCustomer` middleware — the identity-header
  branch, the `allowDefaultCustomer` fallback, and the now-obsolete proxy-secret gate all
  go away (token validation is the only path). `req.customerId` semantics are unchanged, so
  route handlers need no edits.
- Remove `QB_CUSTOMER_HEADER` / `X-authentik-uid` config; add `QB_OIDC_AUTHORITY` /
  `QB_OIDC_AUDIENCE` (sourced from `@qb/auth-config` defaults, env-overridable).
- Deployment env (QB pipeline values) updated for beta + prod authorities.

## 7. Client changes (`@qb/client`)

- New `src/lib/auth/` module (§4.3).
- A `/auth/callback` route (navigo) calling `handleCallback()`.
- Replace raw `fetch` calls to `/api/*` with `authFetch`.
- App bootstrap (`main.ts`): if no valid token, `login()`; else render.

## 8. Ingress (Olve.Homelab `helm/values-{beta,prod}.yaml`)

- Remove `forwardAuthMiddleware` from QB's `apps[]` entries (beta + prod). Hosts,
  external-dns, and TLS unchanged. The API is now self-authenticating, so no edge auth.

## 9. Identity continuity / data migration (`sub` re-key)

Storage is a file-based store partitioned by `customerId` under `QB_DATA_DIR`
(`store.books.getAll(customerId)`, etc.). The old `customerId` is the legacy
`X-authentik-uid` value; the new one is the Authentik user's `sub` (UUID).

- One-time, **idempotent** migration script (`packages/server/src/scripts/`): given
  `OLD_CUSTOMER_ID` → `NEW_SUB`, relabel/move that partition. **Backs up `QB_DATA_DIR`
  first.** Dry-run flag; verifies counts (books/questions/attempts/figures) match
  pre/post.
- Run against prod data once during cutover. Beta needs no migration (disposable).
- Determine the two values up front: legacy id from current prod data; `sub` from a test
  token / Authentik user record.

## 10. Beta smoke tests (`packages/server/tests/beta/smoke.beta.test.ts`)

- Replace the `X-authentik-uid: pipeline-smoke` header with a bearer obtained via the
  machine client's client-credentials grant (token cached for the run).
- Update the `calling-the-questionbank-api` skill to document the token flow (the
  port-forward + header instructions become a token + URL flow).

## 11. Cutover plan (big-bang, beta + prod)

Three repos deploy via different mechanisms, so "atomic" means a tight, ordered sequence
with a known-safe internal order (additive first, flip last):

1. **Authentik** (ArgoCD): add the `questionbank` OAuth2 provider + machine client.
   Additive; proxy provider still active — nothing breaks yet.
2. **QuestionBank** (app pipeline): ship one image with server `requireAuth` + SPA OIDC
   together (server and SPA must change in lockstep). Run the prod data migration.
3. **Olve.Homelab** (homelab pipeline): drop `forwardAuthMiddleware`; retire the proxy
   provider in Authentik.

Brief window where the new image is deployed but forward-auth is still attached is
tolerable: forward-auth injects a header the new server ignores, and the SPA does its own
OIDC. Rollback = redeploy previous image + re-add forward-auth + restore the data backup.

## 12. Testing strategy

- **Server unit:** `verifyBearer` — valid, expired, wrong issuer, wrong audience, bad
  signature, missing claim; against a mock JWKS. `requireAuth` — no token → 401, valid →
  200 + `req.customerId`, `/api/health` open without a token.
- **Client unit:** PKCE challenge generation, callback code→token handling, token store,
  `refresh()`, `authFetch` attaches the bearer and fires the 401 hook — mocked endpoints.
- **Migration:** unit test re-key on a fixture data dir; idempotency (second run is a
  no-op); count verification.
- **Beta smoke:** machine-client token path, then the existing LLM-free round-trip.

## 13. Risks

- **Cutover coordination across three repos** — mitigated by the additive-first order and
  a full rollback path (§11).
- **Prod data loss on re-key** — mitigated by mandatory backup, dry-run, and count checks.
- **Authority/audience/claim mismatch** silently 401ing everything — mitigated by
  centralizing them in `@qb/auth-config` and the `verifyBearer` unit matrix.
- **Token lifetime is short** (known pain) — Project A delivers `refresh()`; smooth UX is
  Project C.

## 14. Repos touched

- **QuestionBank** — `@qb/auth-config`, `@qb/server` auth module + wiring, `@qb/client`
  auth module + callback route, migration script, beta smoke test, skill doc.
- **Olve.Homelab** — `helm/values-{beta,prod}.yaml` ingress entries.
- **homelab** — `infra/authentik/{beta,prod}/blueprints` provider + machine client + outpost.

## 15. Out of scope / follow-ups

- **Project B — `qb` CLI:** TS `@qb/cli`, device-code login against the new provider,
  pl-style noun-verb grammar, `--json`; first commands target the beta smoke/admin surface.
  Reuses `@qb/auth-config`.
- **Project C — FE auth UX:** auto-refresh, redirect-to-relogin on 401, seamless resume
  (return-to routing). Builds on the client auth module's seams.
