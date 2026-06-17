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

# Fetch the shared helper library from Olve.Pipelines for the repo-fetch helper. The
# node image ships GNU wget, which accepts --no-check-certificate harmlessly (the flag
# is needed by the Kaniko busybox wget in package.sh, not here). Swap `main` to pin.
mkdir -p /tmp
wget --no-check-certificate -qO /tmp/olve-lib.sh \
  https://raw.githubusercontent.com/OliverVea/Olve.Pipelines/main/.pipelines/scripts/olve-lib.sh
. /tmp/olve-lib.sh

# Fetch QuestionBank's own code (each step runs in a fresh container, no git checkout).
olve_fetch_repo OliverVea/QuestionBank master /src

# Dependencies are pure-JS (no native/gyp); .npmrc pins the public registry.
npm ci

# Typecheck the whole workspace (server + client + their test projects).
npm run typecheck

# Offline server suite: unit + in-process api-uat against the scripted FakeProvider.
# LLM-free and network-free, so it is safe to run as a hard pre-deploy gate.
npm run test:server

echo "In-code tests passed."
