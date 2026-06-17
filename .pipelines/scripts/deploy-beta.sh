#!/bin/sh
# PROCESSING 0: deploy to apps-beta and gate the rest of the chain. Import the
# built image into the homelab k3s containerd, helm-upgrade the beta release with
# beta overrides, then verify the beta rollout is healthy. A failure here stops the
# chain so test-after-beta and prod never run.
# The ssh/import/helm footguns live in the shared olve-lib.sh (Olve.Pipelines #17).
set -e

# Fetch the shared helper library from Olve.Pipelines (the LIBRARY repo, distinct from
# this app). mkdir -p /tmp for parity with the build images. Swap `main` to pin.
mkdir -p /tmp
wget --no-check-certificate -qO /tmp/olve-lib.sh \
  https://raw.githubusercontent.com/OliverVea/Olve.Pipelines/main/.pipelines/scripts/olve-lib.sh
. /tmp/olve-lib.sh

# curl is needed by the in-pod health loop below; olve_ssh_host installs only the ssh
# client. Cluster DNS (*.svc.cluster.local) resolves from inside this JOB POD, not from
# the k3s host — so kubectl runs over ssh on the host, but the health curl runs HERE.
apk add --no-cache curl

HOST=oliver@bulwark-m2
RELEASE=questionbank

olve_ssh_host bulwark-m2

INPUT_DIR=$(olve_bundle_input)
VERSION=$(cat "$INPUT_DIR/version.txt")

echo "Deploying $RELEASE:$VERSION to apps-beta"

olve_image_import "$INPUT_DIR/image.tar" "$HOST"

# Helm upgrade with BETA values (values-beta.yaml: minimal/self-sufficient — NO ingress,
# NO forward-auth — but with beta's own Anthropic key for LLM routes). Routing + the auth
# system are owned by the separate Olve.Homelab pipeline; beta is reachable in-cluster only.
olve_helm_deploy "$HOST" "$RELEASE" apps-beta "$INPUT_DIR/helm" "$VERSION" -f values-beta.yaml

# Wait for the rollout, then verify reachability — if beta is unhealthy, fail so the
# rest of the chain (test-after-beta, prod) never runs.
echo "Waiting for beta rollout..."
ssh -o StrictHostKeyChecking=no "$HOST" \
  "kubectl -n apps-beta rollout status deploy/$RELEASE --timeout=120s"

# Health-gate the in-cluster Service directly FROM THIS POD (NOT over ssh on the host,
# which can't resolve *.svc.cluster.local). /api/health is open (no auth).
echo "Verifying beta /api/health..."
for i in 1 2 3 4 5; do
  if curl -sf -o /dev/null http://questionbank.apps-beta.svc.cluster.local/api/health; then
    echo "Beta health OK"
    exit 0
  fi
  sleep 5
done
echo "Beta health check failed" >&2
exit 1
