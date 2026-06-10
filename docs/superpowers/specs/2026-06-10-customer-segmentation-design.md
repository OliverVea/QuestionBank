# Customer Segmentation + Storage Abstraction

**Status:** Approved design. TODO task 0 — do before building more BE/UI on top.
**Date:** 2026-06-10
**Architecture reference:** [2026-06-06-question-bank-architecture.md](./2026-06-06-question-bank-architecture.md)

## Scope

Scope every data entity to a **customer** so multiple customers' data coexist without leaking, and harden the storage layer into a clean async seam so a SQL or DynamoDB backend can be dropped in later with no churn across routes/services.

The frontend has been removed and persisted data is being wiped, so this is a **clean start** — no migration, no backward compatibility to preserve.

**In scope:** a required `customerId` on every entity; an async, customer-scoped `Repository<T>` contract; per-request customer resolution middleware (proxy-secret → identity header → default → 401); threading `customerId` explicitly through all routes and services; integration tests proving segmentation; a documented deployment trust boundary for a Traefik/Authentik homelab.

**Out of scope (YAGNI / future):** a first-class `Customer` entity or `/api/customers` CRUD; real in-API auth / OIDC token validation; per-customer settings or provider config (TODO #11); the actual SQL/DDB implementation (TODO #13 — only the *seam* is built here).

## Guiding principle

**Boring and explicit.** No implicitly-scoped "magic store," no per-request store rebinding, no escape hatches to reason about. Customer resolution happens in one place (middleware); `customerId` is then passed explicitly as the leading argument into every storage call. What you read is what runs — and background batch jobs or stores that don't fit the per-customer pattern remain naturally expressible, because nothing is implicitly bound to a single customer.

## Data model

Every persisted entity gains a **required** `customerId: string`:

- `Book`, `Chapter`, `Question`, `Attempt` each gain `customerId`.
- `customerId` is an **opaque string** — whatever stable id the identity source emits (Authentik `uid`, username, email, or the literal `"local"`). No `Customer` type, no validation of its shape, no CRUD. A customer "exists" the moment it owns data.
- Because data is wiped, entities are simply born with the field; there is no migration.

## Repository contract (async + explicit `customerId`)

`Repository<T>` becomes **async** and **customer-scoped**, with `customerId` always the leading argument:

```ts
interface Repository<T extends { id: string; customerId: string }> {
  getAll(customerId: string): Promise<T[]>;
  getById(customerId: string, id: string): Promise<T | undefined>;
  create(customerId: string, entity: T): Promise<T>;
  update(customerId: string, id: string, patch: Partial<Omit<T, 'id' | 'customerId'>>): Promise<T>;
  delete(customerId: string, id: string): Promise<void>;
}
```

Rules:

- **Wrong-owner is not-found.** If an entity exists but belongs to a different customer: `getById` → `undefined`; `update` throws not-found; `delete` is a no-op. A caller can never learn that another customer's entity exists, and routes' existing 404 handling works unchanged with no new error path.
- **`id` and `customerId` are immutable** via `update` (both excluded from the patch type). `create` stamps/validates the entity's `customerId` against the passed argument.
- **Required leading argument.** Because `customerId` is required and first, the type checker fails the build if a call site forgets it. (It cannot catch a *wrong* id — that is what the segmentation tests are for.)

### Why async now

The in-memory JSON backend could stay synchronous, but SQL/DDB are inherently async. Making the contract return `Promise`s now — while the JSON impl simply resolves immediately — means adding a real backend later is a drop-in with zero route/service churn. This is the one seam that is expensive to retrofit, so it is done while the diff is mechanical (add `async`/`await`).

### Backend implementations

Same contract, each backend scopes its own way:

- **JSON (now):** filter the in-memory array on `customerId`; write-through unchanged.
- **SQL (future):** `WHERE customer_id = ?`.
- **DynamoDB (future):** `customerId` as the partition key.

The `JsonCollection` `update()` shallow-merge currently cannot delete a key (the questions route hacks around it with delete+recreate for clear-snooze). This is pre-existing and out of scope here; it is noted so the implementation does not mistake it for new behavior.

## Request → customer resolution

A single `resolveCustomer` middleware runs the following **ordered chain** and sets `req.customerId`:

1. **Proxy-secret gate (optional).** If `QB_TRUSTED_PROXY_SECRET` is set, the request must carry a matching secret header (`QB_PROXY_SECRET_HEADER`, default `X-Proxy-Secret`) whose value equals the env secret, compared in **constant time**. Absent/mismatch → `401`, before any identity resolution. Unset → this gate is skipped entirely.
2. **Identity header.** If the configured header (`QB_CUSTOMER_HEADER`, default `X-Customer-Id`) is present → `req.customerId = value`.
3. **Default fallback.** If the identity header is absent **and** `QB_ALLOW_DEFAULT_CUSTOMER` is truthy → `req.customerId = "local"`.
4. **Else → `401`.**

Routes read `req.customerId` and pass it explicitly into every store call. Resolution is centralized in one place; passing is boring and explicit per call site.

### Configuration summary

| Env var | Default | Effect |
| --- | --- | --- |
| `QB_CUSTOMER_HEADER` | `X-Customer-Id` | Name of the trusted identity header. Behind Authentik, set to e.g. `X-authentik-uid`. |
| `QB_ALLOW_DEFAULT_CUSTOMER` | **off** | When on, an unattributed request falls back to customer `"local"` instead of 401. For local/dev/tests. |
| `QB_TRUSTED_PROXY_SECRET` | unset | When set, requires a matching proxy-secret header (proof-of-proxy). |
| `QB_PROXY_SECRET_HEADER` | `X-Proxy-Secret` | Name of the proxy-secret header checked when the secret is set. |

Strict by default: a bare run with no env set rejects every unattributed request rather than silently trusting whatever header arrives. Local `.env` and the test harness set `QB_ALLOW_DEFAULT_CUSTOMER`.

## Deployment / trust boundary (Traefik + Authentik homelab)

The API is designed to sit behind a forward-auth proxy and performs **no token or credential validation by design** — auth lives in infra.

- **Authentik authenticates; the API trusts the result.** With Traefik forward-auth, Traefik calls Authentik's outpost and only forwards the request on a 2xx, copying Authentik's identity headers onto it. By the time the API sees a request, authentication has already succeeded; there is no token for the API to re-validate, and re-validating would couple the API to OIDC/Authentik and contradict the auth-agnostic goal.
- **The identity header is proof of identity.** The configured `QB_CUSTOMER_HEADER` is read as-is.
- **The proxy-secret is proof-of-proxy, not proof-of-identity.** `QB_TRUSTED_PROXY_SECRET` only attests "this request came through our Traefik," hardening the sole-ingress invariant against accidental direct exposure. It is not authentication.

**Hard deployment requirements** (the design is only safe when these hold):

1. The API must **not be directly reachable** — Traefik is the sole ingress.
2. The forward-auth middleware must **strip/overwrite any client-supplied identity and proxy-secret headers** before proxying, so only the proxy's values survive. (Configure `authResponseHeaders` to whitelist exactly the identity headers; drop client-supplied copies.)
3. `QB_ALLOW_DEFAULT_CUSTOMER` and `QB_TRUSTED_PROXY_SECRET` are the only sanctioned ways to run outside this topology (local/dev).

These requirements are documented, not enforced in API code, because the proxy is the correct place to enforce them — with the proxy-secret as cheap belt-and-suspenders.

## Services & cascades

`tree.ts`, `cascade.ts`, `learn-next.ts`, `due-queue.ts` each take `customerId` as a leading parameter and thread it into their (now awaited) store calls. Their cross-entity `getAll().filter(...)` joins stay — just scoped and async. Routes pass `req.customerId` through. A future cross-customer batch job loops over customers and calls the same explicit methods; nothing is implicitly bound to a single customer, so such jobs need no special escape hatch.

## API surface

URLs are **unchanged** — tenancy is carried by the resolved header/`req.customerId`, not by the path. The existing routes (`/api/books`, `/api/chapters`, `/api/questions`, `/api/learn`, `/api/practice`, attempts/transcribe/grade) keep their shapes; each handler now resolves `req.customerId` and passes it into the store. Unattributed requests are rejected by the resolution middleware before reaching any handler.

## Testing

Per the project test strategy (favor high-level integration/e2e; avoid granular unit tests):

- Existing route tests get a customer identity — either an `X-Customer-Id` header or the `QB_ALLOW_DEFAULT_CUSTOMER` default — and otherwise keep asserting current behavior.
- **Segmentation tests** (the new safety-critical coverage): customer A cannot read, patch, or delete customer B's books/chapters/questions/attempts — each returns 404 or an empty list, never B's data. Tree, learn-next, and due-queue results are scoped to the requesting customer.
- **Resolution tests:** an unattributed request 401s when `QB_ALLOW_DEFAULT_CUSTOMER` is off and resolves to `"local"` when it is on; when `QB_TRUSTED_PROXY_SECRET` is set, a request without the matching proxy-secret header 401s and one with it passes.
