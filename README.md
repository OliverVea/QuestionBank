# Question Bank

A question bank for books. Client-side app backed by a small server.

## What this is

A self-study question bank for working through physics and math textbooks. It solves two problems:

**1. Grading handwritten solutions.** Capture questions from a textbook (photo or text), then submit a handwritten solution and get LLM-assisted feedback. The flow separates concerns deliberately: one agent faithfully transcribes your answer to LaTeX (blind to the problem, no hints), a second agent critiques the transcribed answer and suggests a rating, and you set the final rating (DNM / partial / full).

**2. Retaining understanding.** A spaced-repetition system resurfaces questions over time (1 week, then 1 month) so the material sticks, prioritizing weaker results.

### Principles

- **Server-side LLM.** The server runs 24/7 and shells out to the local Claude Code CLI, so no per-client auth is needed. The LLM layer is modular — swappable for the Anthropic API, Bedrock, or a self-hosted model.
- **History is immutable.** Review outcomes are an append-only log; scheduling is derived from it, so the algorithm can evolve without data migrations.
- **Framework-free.** Express on the server, vanilla TypeScript on the client. Reachable from PC and mobile.

## Stack

- **Server:** Node + Express (TypeScript, ESM)
- **Client:** Vanilla TypeScript + Vite
- **Storage:** JSON files on disk (under `~/.question-bank/`, override with `QB_DATA_DIR`)
- **Tests:** Vitest
- **Layout:** npm workspaces — `packages/server`, `packages/client`

The goal is to stay close to framework-free. Express is the one concession on the server; the client is plain TypeScript against the DOM.

## Requirements

- Node.js >= 20
- npm >= 10

## Getting started

```bash
QB_ALLOW_DEFAULT_CUSTOMER=1 npm run dev
```

This starts:

- Server on http://localhost:3001 (health check at `/api/health`)
- Client on http://localhost:5173 (proxies `/api/*` to the server)

`QB_ALLOW_DEFAULT_CUSTOMER=1` is required for local use: by default the API rejects any
request that carries no customer identity (see [Customer segmentation](#customer-segmentation)).
With it set, unattributed requests resolve to the `local` customer.

Open http://localhost:5173 — you'll see the three-tab shell (Learn / Practice / Manage) with the Manage tab active for adding books, chapters, and questions.

## Customer segmentation

Every data entity is scoped to a **customer** (an opaque string id) so multiple customers'
data coexist without leaking. The API performs **no token validation by design** — it is meant
to sit behind a forward-auth proxy (e.g. Traefik + Authentik) that authenticates the request
and forwards an identity header. The API trusts that header.

A single middleware resolves the owning customer for each `/api` request (the order matters):

1. **Proxy-secret gate** (only if `QB_TRUSTED_PROXY_SECRET` is set): the request must carry a
   matching secret header, compared in constant time. Absent/mismatch → `401`.
2. **Identity header**: if `QB_CUSTOMER_HEADER` is present, its value is the customer id.
3. **Default fallback**: if the identity header is absent and `QB_ALLOW_DEFAULT_CUSTOMER` is
   truthy, the customer is `local`.
4. Otherwise → `401`.

| Env var | Default | Effect |
| --- | --- | --- |
| `QB_CUSTOMER_HEADER` | `X-Customer-Id` | Trusted identity header. Behind Authentik, set to e.g. `X-authentik-uid`. |
| `QB_ALLOW_DEFAULT_CUSTOMER` | off | When truthy, unattributed requests fall back to customer `local`. For local/dev/tests. |
| `QB_TRUSTED_PROXY_SECRET` | unset | When set, requires a matching proxy-secret header (proof-of-proxy, not identity). |
| `QB_PROXY_SECRET_HEADER` | `X-Proxy-Secret` | Name of the proxy-secret header checked when the secret is set. |

**Deployment requirements** (the design is only safe when these hold — enforced by the proxy,
not the API): the API must not be directly reachable (the proxy is the sole ingress); the proxy
must strip/overwrite any client-supplied identity and proxy-secret headers so only its own values
survive. `QB_ALLOW_DEFAULT_CUSTOMER` and `QB_TRUSTED_PROXY_SECRET` are the only sanctioned ways
to run outside this topology.

## Scripts

| Command            | What it does                                  |
| ------------------ | --------------------------------------------- |
| `npm run dev`      | Run server and client together in watch mode  |
| `npm run build`    | Type-check and build both packages            |
| `npm run typecheck`| Type-check the whole project                  |
| `npm test`         | Run tests with Vitest                         |

## Layout

```
packages/
  server/   Express API
  client/   Vite + vanilla TS frontend
```

Data lives outside the repo at `~/.question-bank/` (JSON files, plus `images/` and
`.backups/` later). Override the location with the `QB_DATA_DIR` environment variable.
The directory is created on first write.
