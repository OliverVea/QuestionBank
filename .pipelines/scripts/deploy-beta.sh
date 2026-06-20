#!/bin/sh
# PROCESSING 0: deploy BOTH the figure-service AND QuestionBank to apps-beta, in that
# order, then gate the rest of the chain. The figure-service comes up FIRST so its
# figure-service-auth secret and Service exist before QB mounts the key / points at its
# URL. A failure anywhere here stops the chain so test-after-beta and prod never run.
# The ssh/import/helm footguns live in the shared olve-lib.sh (Olve.Pipelines #17).
set -e

# Fetch the shared helper library from Olve.Pipelines (the LIBRARY repo, distinct from
# this app). mkdir -p /tmp for parity with the build images. Swap `main` to pin.
mkdir -p /tmp
wget --no-check-certificate -qO /tmp/olve-lib.sh \
  https://raw.githubusercontent.com/OliverVea/Olve.Pipelines/main/.pipelines/scripts/olve-lib.sh
. /tmp/olve-lib.sh

# curl is needed by the in-pod health loops below; olve_ssh_host installs only the ssh
# client. Cluster DNS (*.svc.cluster.local) resolves from inside this JOB POD, not from
# the k3s host — so kubectl runs over ssh on the host, but the health curl runs HERE.
apk add --no-cache curl

HOST=oliver@bulwark-m2
NS=apps-beta

olve_ssh_host bulwark-m2

# ── figure-service (FIRST: QB below mounts its secret and points at its Service URL) ──
FIG_RELEASE=questionbank-figures

# Select the figure build's bundle dir by its distinct marker (NOT version.txt, which
# is the QB build's selector).
FIG_INPUT_DIR=$(dirname "$(ls /input/*/figures-version.txt | head -1)")
FIG_VERSION=$(cat "$FIG_INPUT_DIR/figures-version.txt")

echo "Deploying $FIG_RELEASE:$FIG_VERSION to $NS"

# Materialize the shared API key into figure-service-auth (key api-key) in this ns.
# Mounted as FIGURE_SERVICE_API_KEY by BOTH the figure-service (to validate the X-API-Key
# header) and the QB server (to send it). Fail loud if unset — an empty key would silently
# DISABLE auth on the service.
[ -n "$FIGURE_SERVICE_API_KEY" ] || { echo "FIGURE_SERVICE_API_KEY unset" >&2; exit 1; }
ssh -o StrictHostKeyChecking=no "$HOST" \
  "kubectl -n $NS create secret generic figure-service-auth \
     --from-literal=api-key='$FIGURE_SERVICE_API_KEY' \
     --dry-run=client -o yaml | kubectl apply -f -"

olve_image_import "$FIG_INPUT_DIR/image.tar" "$HOST"
ssh -o StrictHostKeyChecking=no "$HOST" "sudo crictl images | grep $FIG_RELEASE"

# No -f override: beta and prod use the figure chart's values.yaml (in-cluster only).
olve_helm_deploy "$HOST" "$FIG_RELEASE" "$NS" "$FIG_INPUT_DIR/helm" "$FIG_VERSION"

echo "Waiting for $FIG_RELEASE rollout in $NS (heavy image)..."
ssh -o StrictHostKeyChecking=no "$HOST" \
  "kubectl -n $NS rollout status deploy/$FIG_RELEASE --timeout=300s"

echo "Verifying $FIG_RELEASE /health..."
fig_ok=
for i in 1 2 3 4 5 6; do
  if curl -sf -o /dev/null "http://$FIG_RELEASE.$NS.svc.cluster.local/health"; then
    echo "figure-service beta OK"
    fig_ok=1
    break
  fi
  sleep 5
done
[ -n "$fig_ok" ] || { echo "figure-service beta health check failed" >&2; exit 1; }

# ── QuestionBank (AFTER the figure-service is healthy) ──
RELEASE=questionbank

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
