---
name: calling-the-questionbank-api
description: Use when you need to call the deployed QuestionBank HTTP API end-to-end (e.g. to verify a deployed feature, smoke-test beta, or reproduce an API bug against the real cluster) — explains how to reach the in-cluster beta instance, authenticate as an isolated tenant, the endpoint surface, and the two standing gotchas (LLM-route auth, undeployed routes).
---

# Calling the QuestionBank API (deployed beta)

## Overview

Beta runs in the homelab k3s cluster (namespace `apps-beta`) as a **ClusterIP
Service with no public ingress** — Olve.Homelab owns routing. To call it from a
dev machine you `kubectl port-forward` the Service and stamp an identity header
yourself (the ingress forwardAuth that normally injects identity is bypassed).

This is the same access path the pipeline's after-beta smoke suite uses
(`packages/server/tests/beta/smoke.beta.test.ts`) — read that file for the
canonical assertions; this skill is the manual/interactive version.

**Core principle:** beta is a real shared instance. Use the dedicated test
tenant, never exercise paid LLM routes casually, and always clean up what you write.

## 1. Reach the instance (port-forward)

```bash
kubectl -n apps-beta get svc questionbank          # ClusterIP, port 80 → targetPort 3001
kubectl -n apps-beta port-forward svc/questionbank 8088:80 &   # backgrounded
# now: http://localhost:8088
```

There is **no externally reachable beta URL** — in-cluster it's
`http://questionbank.apps-beta.svc.cluster.local`, which only resolves inside the
cluster. Port-forward (or run from inside the cluster) is the only way in.

Companion service: `svc/questionbank-figures` (the dewarp + figure-detection
service) on the same namespace, also ClusterIP-only.

## 2. Authenticate (the tenant header)

Beta runs `QB_ALLOW_DEFAULT_CUSTOMER=0` (strict). Every `/api` request must carry
its own identity header — there is no session/login here:

```
X-authentik-uid: pipeline-smoke
```

That value is BOTH the auth credential AND a **tenant id**. `pipeline-smoke` is the
shared, isolated test tenant — its data is disposable and never belongs to a real
user. Reuse it; do not invent new tenant ids and do not use a real user's uid.

- `GET /api/health` — open readiness probe, **no header** (returns `{"status":"ok"}`).
- Any `/api/*` with **no header → 401** (proves strict mode is live).
- With the header → scoped to the `pipeline-smoke` tenant.

```bash
H='X-authentik-uid: pipeline-smoke'
curl -s http://localhost:8088/api/health                 # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8088/api/books   # 401 (no header)
curl -s -H "$H" http://localhost:8088/api/books          # [] or the tenant's books
```

## 3. Endpoint surface (verified E2E, LLM-free)

All of these are writeable without spending LLM money. `Content-Type: application/json`
for JSON bodies; multipart for image uploads.

```bash
H='X-authentik-uid: pipeline-smoke'; J='Content-Type: application/json'; B=http://localhost:8088

# Books
curl -s -H "$H" -H "$J" -X POST "$B/api/books" -d '{"title":"probe","author":"me"}'   # 201 → {id,...}
curl -s -H "$H" "$B/api/books/$BID"                                                    # read one
curl -s -H "$H" "$B/api/books"                                                         # list (tenant-scoped)

# Questions — batch upsert (returns rows in INCOMING order, not re-sorted)
curl -s -H "$H" -H "$J" -X PUT "$B/api/books/$BID/questions" \
  -d '{"questions":[{"label":"1","canonicalText":"What is 2+2?"}]}'                    # 200 → [{id,...}]
curl -s -H "$H" "$B/api/questions/$QID"                                                # flat read
curl -s -H "$H" "$B/api/books/$BID/questions"                                          # list, DERIVED path order, enriched .summary

# Attempts (LLM-free write — client supplies the grade fields)
curl -s -H "$H" -H "$J" -X POST "$B/api/questions/$QID/attempts" \
  -d '{"answer":"4","recommendedGrade":"correct","rating":"correct","issues":[]}'      # 201

# SRS surfaces
curl -s -H "$H" "$B/api/learn/next"                       # {question: ... | null}
curl -s -H "$H" "$B/api/practice/due"                     # [...]
curl -s -H "$H" "$B/api/practice/due?count=true"          # {count: N}
```

A recorded attempt immediately updates the question's SRS state — the
`/books/:id/questions` summary then shows `mastery`, `readiness`, `grades`, and a
`nextReviewDate`. That round-trip is the cheapest full E2E proof the box is wired.

### LLM + image routes (cost real money — beta wires a real Anthropic key)

- `POST /api/extract` (multipart: `bookId` + `images`) → extraction deltas.
- `POST /api/extract/refine` → re-extract with section answers.
- `POST /api/questions/:id/transcribe` / `/grade` → LLM grading.
- `POST /api/scan` (multipart: `bookId` + `images`) → **figure-extraction** pipeline
  (extract ∥ figure-service detect → matcher). See `docs/design/figure-extraction-spec.md`.
- Figure CRUD: `POST|DELETE /api/questions/:id/figures`, `GET /api/figures/:figId/image`.

```bash
# Example (incurs an Anthropic call):
curl -s -H "$H" -F "bookId=$BID" -F "images=@page.jpg;type=image/jpeg" "$B/api/extract"
```

Real textbook page fixtures live in `experiments/figure-matching/cases/test_*/test_*.jpg`
(with the figure-service's recorded `rectified.jpg` + `figures.json` alongside).

## 4. Always clean up

Deleting a book cascades to its questions, attempts, and figures:

```bash
curl -s -H "$H" -X DELETE "$B/api/books/$BID" -w '%{http_code}\n'   # 204
curl -s -H "$H" "$B/api/books"                                      # confirm []
```

## 5. Standing gotchas (verified 2026-06-21)

1. **Beta's Anthropic key returns 401.** All LLM routes currently fail fast:
   `/api/extract` → `502 {"error":"extraction failed"}`; the pod logs show
   `llm completeStructured request failed model=claude-sonnet-4-6 status=401`. The
   LLM-free surface (above) is healthy. Fix is out-of-band: the `questionbank-secrets`
   secret in `apps-beta` (key `ANTHROPIC_API_KEY`) needs a valid key. Until then,
   any LLM/scan E2E on beta will 502 regardless of the request.

2. **A route that returns the SPA `index.html` (HTTP 200, `content-type: text/html`)
   is NOT deployed.** Express falls through unmatched paths to the SPA catch-all, so a
   missing `/api/*` route looks like a 200 page, not a 404. Confirm a route exists by
   checking `content-type`: JSON (even a 400/401) = route present; HTML = the deployed
   image predates that route. Check the running build with
   `kubectl -n apps-beta get deploy questionbank -o jsonpath='{.spec.template.spec.containers[0].image}'`
   (tag is a `YYYYMMDD-HHMMSS` build stamp). The figure routes (`/api/scan`, `/api/figures`)
   only exist once an image built from the figure-extraction commit is deployed.

3. **`for`-loops with command substitution can drop `PATH` in this shell** — if `curl`/`kubectl`
   report "command not found" inside a loop but work standalone, unroll the loop into
   sequential calls.

## Quick reference

| Need | Command |
| --- | --- |
| Open the instance | `kubectl -n apps-beta port-forward svc/questionbank 8088:80 &` |
| Health (no auth) | `curl -s localhost:8088/api/health` |
| Auth header | `-H 'X-authentik-uid: pipeline-smoke'` |
| Deployed build | `kubectl -n apps-beta get deploy questionbank -o jsonpath='{..image}'` |
| Server logs | `kubectl -n apps-beta logs deploy/questionbank --tail=50` |
| Canonical assertions | `packages/server/tests/beta/smoke.beta.test.ts` |
