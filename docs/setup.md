# Setup

How to run Question Bank yourself, configure it, and deploy it. For what the app does,
see the [README](../README.md).

## Requirements

- Node.js >= 20
- npm >= 10

```bash
npm install
```

## Quick look: the demo, locally

```bash
QB_DEMO=1 npm run dev
```

Open http://localhost:5173. This is the same mode as the
[public demo](https://questionbank-demo.ovea.pro): no login and no API key. Each browser
gets its own copy of a sample library, and model calls replay recorded results, so only
the provided sample answer can be graded.

## Full local development

The full app needs two things the demo does without:

1. **An Anthropic API key** for scanning pages, reading answers and grading.
2. **An OIDC provider** for login. The server checks a bearer token on every `/api`
   request and won't start without `QB_OIDC_AUTHORITY`.

Put them in a `.env` file at the repo root. `npm run dev` loads it for the server:

```bash
ANTHROPIC_API_KEY=sk-ant-...
QB_OIDC_AUTHORITY=https://auth-beta.ovea.pro/application/o/questionbank/
```

```bash
npm run dev
```

- Server on http://localhost:3001 (health check at `/api/health`)
- Client on http://localhost:5173 (proxies `/api/*` to the server)

### Using your own OIDC provider

The login settings live in [`packages/auth-config`](../packages/auth-config/src/index.ts),
shared by the server, the browser client and the CLI. They point at the author's
Authentik instances: the browser uses the `prod` authority on `questionbank.ovea.pro`
and `beta` everywhere else, including `localhost`.

To use your own provider:

1. Register a public OIDC client (authorization code + PKCE) with client id
   `questionbank` and redirect URI `http://localhost:5173/auth/callback`. Tokens must
   carry `aud = questionbank`.
2. Change `AUTHORITIES` in `packages/auth-config/src/index.ts` to your issuer URL.
3. Set `QB_OIDC_AUTHORITY` to the same URL.

Each user's data is keyed by the token's `sub` claim.

## Configuration

Server environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | none | Key for all model calls. Not needed in demo mode. |
| `QB_OIDC_AUTHORITY` | none, required | OIDC issuer the server validates tokens against. Not needed in demo mode. |
| `QB_OIDC_AUDIENCE` | `questionbank` | Expected token audience. |
| `QB_DATA_DIR` | `~/.question-bank` | Where the JSON data files and figure crops are kept. Created on first write. |
| `PORT` / `HOST` | `3001` / `0.0.0.0` | Where the server listens. |
| `FIGURE_SERVICE_URL` | none | Base URL of the figure service. Without it, figure detection is off. |
| `FIGURE_SERVICE_API_KEY` | none | Shared key sent to the figure service. |
| `QB_DEMO` | off | `1` runs the public demo: guest tenants, no login, recorded model results. |
| `QB_DEMO_RECORD` | off | With `QB_DEMO=1`, call the real model and save the results as the demo's recordings. Local, one-off use. |
| `QB_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. `debug` logs model requests and responses. |
| `QB_LOG_FORMAT` | pretty | `json` for structured logs. |

## Figure service (optional)

Flattening page photos and finding figures runs in a separate Python service,
[`services/figure-service`](../services/figure-service/README.md). Run it locally with:

```bash
cd services/figure-service
uv sync
uv run flask --app app run --host 0.0.0.0 --port 8000
```

Then set `FIGURE_SERVICE_URL=http://localhost:8000` for the server.

## Command-line client

`packages/cli` is a small `qb` command for the API: `qb login` (device-flow login),
`qb books`, `qb books add <title>`, `qb books rm <id>`, `qb logout`. Build it with
`npm run build:cli`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Run server and client together in watch mode |
| `npm run build` | Type-check and build all packages |
| `npm run typecheck` | Type-check the whole project, including tests |
| `npm test` | Run the server and client test suites with Vitest |
| `npm run test:beta` | Smoke-test a deployed beta instance |
| `npm run mocks` | Serve the static UI mocks in `docs/mocks` |

## Layout

```
packages/
  server/        Express API (TypeScript, ESM)
  client/        Vite + plain TypeScript frontend, no UI framework
  auth-config/   OIDC settings shared by server, client and CLI
  cli/           The qb command
services/
  figure-service/  Python service for page flattening and figure detection
helm/            Helm chart and per-environment values
.pipelines/      CD pipeline definition
```

Data is stored as JSON files outside the repo, so it can't be committed by accident.
The storage layer is kept thin so it can move to SQLite later.

## Deployment

- **Docker.** The [`Dockerfile`](../Dockerfile) builds one image that serves both the
  API and the built client on port 3001, with data under `/data`.
  [`docker-compose.yml`](../docker-compose.yml) runs it with settings from `.env`.
- **Kubernetes.** The [Helm chart](../helm) has values for production
  (`values-minimal.yaml`), beta (`values-beta.yaml`) and the public demo
  (`values-demo.yaml`). The demo profile mounts no secrets.
- **Pipeline.** [`.pipelines/pipeline.ts`](../.pipelines/pipeline.ts), run by
  Olve.Pipelines v2, takes every push to `master` through: build the app and figure
  service images and run `npm run typecheck` and `npm test`; deploy both to `apps-beta`
  and run `npm run test:beta` against it; then deploy to `apps`, smoke-test production
  read-only and deploy the demo. The figure service image goes through
  `registry.ovea.pro` and is rebuilt only when `services/figure-service` changes.

## Further reading

- [Design assumptions](design/assumptions.md)
- [Figure extraction design](design/figure-extraction-hld.md)
- [Architecture spec](superpowers/specs/2026-06-06-question-bank-architecture.md)
- [Agent and contributor conventions](../AGENTS.md)
