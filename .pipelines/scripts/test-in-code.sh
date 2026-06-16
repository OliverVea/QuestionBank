#!/bin/sh
# PRODUCTION (parallel with packaging): cheap code-correctness gate. Runs the
# offline suite — typecheck + the in-process unit/UAT tests (scripted FakeProvider,
# no network, no real LLM). A failure here fails the production group, which blocks
# EVERY processing step (verified by controller test
# `ProductionGroupFailed_NoProcessingTriggered`) — so a red test never deploys.
#
# This is a SEPARATE production step from packaging on purpose: the same checks run
# inside the Docker build today (Dockerfile), but splitting them out makes the gate
# explicit, parallel, and independently reportable.
set -e

REPO=OliverVea/QuestionBank
BRANCH=master

# Each step runs in a fresh container, so fetch the repo tarball ourselves before
# installing. (Official node image ships GNU wget — no --no-check-certificate
# needed, unlike the Kaniko busybox wget in package.sh.)
mkdir -p /src
cd /src
wget -q --header="Authorization: token $GITHUB_TOKEN" \
  -O repo.tar.gz "https://api.github.com/repos/$REPO/tarball/$BRANCH"
tar xzf repo.tar.gz --strip-components=1
rm repo.tar.gz

# Dependencies are pure-JS (no native/gyp); .npmrc pins the public registry.
npm ci

# Typecheck the whole workspace (server + client + their test projects).
npm run typecheck

# Offline server suite: unit + in-process api-uat against the scripted FakeProvider.
# LLM-free and network-free, so it is safe to run as a hard pre-deploy gate.
npm run test:server

echo "In-code tests passed."
