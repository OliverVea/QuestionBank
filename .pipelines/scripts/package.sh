#!/bin/sh
# PRODUCTION: build the app image with Kaniko and stage the deploy artifacts
# (image tar, helm chart, version) into /output so the deploy steps pick them up
# from the bundle. The Kaniko/staging footguns live in the shared olve-lib.sh
# (hosted in Olve.Pipelines; see that repo's issue #17).
set -e

# Fetch the shared helper library from Olve.Pipelines. NOTE: this fetches the LIBRARY
# from a different repo than the app code below — olve_fetch_repo pulls QuestionBank.
# Fetch-to-file, not `. <(...)`: busybox has no process substitution. mkdir -p /tmp:
# the kaniko:debug rootfs has no /tmp, so wget -O /tmp/... fails ENOENT. Swap `main`
# for a tag/SHA to pin the lib.
mkdir -p /tmp
wget --no-check-certificate -qO /tmp/olve-lib.sh \
  https://raw.githubusercontent.com/OliverVea/Olve.Pipelines/main/.pipelines/scripts/olve-lib.sh
. /tmp/olve-lib.sh

REPO=OliverVea/QuestionBank
BRANCH=master
VERSION=$(olve_version)
CTX=/kaniko/build-context

olve_fetch_repo "$REPO" "$BRANCH" "$CTX"

# Carry the helm chart and version forward as build artifacts before Kaniko runs.
olve_stage_artifact "$CTX/helm" /output/helm
echo "$VERSION" > /output/version.txt

olve_kaniko_build "$CTX" "questionbank:$VERSION"

echo "Build complete: questionbank:$VERSION"
