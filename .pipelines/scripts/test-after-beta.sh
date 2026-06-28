#!/bin/sh
# PROCESSING 1: exercise the ACTUALLY-DEPLOYED beta instance over HTTP and gate
# prod. Runs the `beta` vitest project (npm run test:beta) against the live beta
# Service. LLM-FREE only (extract/transcribe/grade cost real money on beta and are
# already proven for free by the in-process api-uat suite). A failure here stops the
# chain so the prod deploy never runs.
set -e

# Fetch the shared helper library from Olve.Pipelines for the repo-fetch helper. Swap `main` to pin.
mkdir -p /tmp
wget --no-check-certificate -qO /tmp/olve-lib.sh \
  https://raw.githubusercontent.com/OliverVea/Olve.Pipelines/main/.pipelines/scripts/olve-lib.sh
. /tmp/olve-lib.sh

# Fetch QuestionBank's own code (fresh container, no git checkout).
olve_fetch_repo OliverVea/QuestionBank master /src

npm ci

# Readiness gate: the in-cluster Service /api/health is open (no auth header).
echo "Waiting for beta /api/health..."
BASE=http://questionbank.apps-beta.svc.cluster.local
i=1
while [ "$i" -le 10 ]; do
  if wget -q -O /dev/null "$BASE/api/health"; then
    echo "Beta health OK"
    break
  fi
  if [ "$i" -eq 10 ]; then
    echo "Beta never became healthy" >&2
    exit 1
  fi
  i=$((i + 1))
  sleep 5
done

# The beta suite reads QB_BETA_BASE_URL and authenticates with a real Authentik
# bearer token minted from the beta machine client (client-credentials) via the
# QB_BETA_OIDC_* env. The token's `sub` is its OWN isolated tenant, so test writes
# never touch real beta users' data. The suite is inert (throws) without
# QB_BETA_BASE_URL, so it never runs in a normal `npm test`.
QB_BETA_BASE_URL="$BASE" \
QB_BETA_OIDC_TOKEN_URL="https://auth-beta.ovea.pro/application/o/token/" \
QB_BETA_OIDC_CLIENT_ID="$QB_BETA_OIDC_CLIENT_ID" \
QB_BETA_OIDC_CLIENT_SECRET="$QB_BETA_OIDC_CLIENT_SECRET" \
  npm run test:beta

echo "After-beta smoke tests passed."
