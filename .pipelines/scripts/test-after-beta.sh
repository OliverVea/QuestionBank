#!/bin/sh
# PROCESSING 1: exercise the ACTUALLY-DEPLOYED beta instance over HTTP and gate
# prod. Runs the `beta` vitest project (npm run test:beta) against the live beta
# Service. LLM-FREE only (extract/transcribe/grade cost real money on beta and are
# already proven for free by the in-process api-uat suite). A failure here stops
# the chain so the prod deploy never runs.
set -e

REPO=OliverVea/QuestionBank
BRANCH=master

# Fresh container — fetch the repo tarball ourselves before installing.
mkdir -p /src
cd /src
wget -q --header="Authorization: token $GITHUB_TOKEN" \
  -O repo.tar.gz "https://api.github.com/repos/$REPO/tarball/$BRANCH"
tar xzf repo.tar.gz --strip-components=1
rm repo.tar.gz

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

# The beta suite reads QB_BETA_BASE_URL and sends X-authentik-uid: pipeline-smoke
# on every request — its OWN isolated tenant, so test writes never touch real beta
# users' data. The suite is inert (throws/skips) without QB_BETA_BASE_URL, so it
# never runs in a normal `npm test`.
QB_BETA_BASE_URL="$BASE" npm run test:beta

echo "After-beta smoke tests passed."
