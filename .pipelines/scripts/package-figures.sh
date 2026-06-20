#!/bin/sh
# PRODUCTION: build the figure-service image with Kaniko and stage its deploy
# artifacts (image tar via /output/image.tar, helm chart, version) into /output so
# the figure deploy steps pick them up from the bundle.
#
# This image is HEAVY (torch CPU + DocLayout-YOLO + UVDoc weights baked in at build
# via the Dockerfile's warmup), so this step is slower/larger than the Node build.
#
# Bundle-selection note: this writes figures-version.txt (NOT version.txt). The QB
# deploy steps select their bundle dir via `ls /input/*/version.txt` (olve_bundle_input),
# so a distinct marker keeps that selector unambiguous; the figure deploy steps select
# via figures-version.txt.
set -e

mkdir -p /tmp
wget --no-check-certificate -qO /tmp/olve-lib.sh \
  https://raw.githubusercontent.com/OliverVea/Olve.Pipelines/main/.pipelines/scripts/olve-lib.sh
. /tmp/olve-lib.sh

REPO=OliverVea/QuestionBank
BRANCH=master
VERSION=$(olve_version)
CTX=/kaniko/build-context

olve_fetch_repo "$REPO" "$BRANCH" "$CTX"

# Carry the figure-service helm chart + a distinct version marker forward before Kaniko runs.
olve_stage_artifact "$CTX/services/figure-service/helm" /output/helm
echo "$VERSION" > /output/figures-version.txt

# Build from the figure-service subdir (its Dockerfile COPYs from its own context root).
olve_kaniko_build "$CTX/services/figure-service" "questionbank-figures:$VERSION"

echo "Build complete: questionbank-figures:$VERSION"
