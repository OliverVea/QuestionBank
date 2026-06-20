#!/bin/sh
# PROCESSING 2: deploy BOTH the figure-service AND QuestionBank to prod (apps), in that
# order. Runs only after deploy-beta AND test-after-beta succeed. The figure-service comes
# up FIRST so its figure-service-auth secret and Service exist before QB mounts the key /
# points at its Service URL.
#
# MINIMAL profile (Tier-A decoupling): no public Ingress, no Authentik forward-auth.
# Routing (Cloudflare ingress) and the Authentik auth SYSTEM are owned by the
# separate Olve.Homelab pipeline. This deploy stays self-sufficient and reachable
# in-cluster only. The ssh/import/helm footguns live in the shared olve-lib.sh
# (Olve.Pipelines #17).
set -e

# Fetch the shared helper library from Olve.Pipelines (the LIBRARY repo, distinct from
# this app). mkdir -p /tmp for parity with the build images. Swap `main` to pin.
mkdir -p /tmp
wget --no-check-certificate -qO /tmp/olve-lib.sh \
  https://raw.githubusercontent.com/OliverVea/Olve.Pipelines/main/.pipelines/scripts/olve-lib.sh
. /tmp/olve-lib.sh

# curl is needed by the in-pod health loops below; olve_ssh_host installs only the ssh
# client. kubectl runs over ssh on the host; the health curl runs HERE in the job pod —
# only the pod resolves *.svc.cluster.local.
apk add --no-cache curl

HOST=oliver@bulwark-m2
NS=apps

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

olve_helm_deploy "$HOST" "$FIG_RELEASE" "$NS" "$FIG_INPUT_DIR/helm" "$FIG_VERSION"

echo "Waiting for $FIG_RELEASE rollout in $NS (heavy image)..."
ssh -o StrictHostKeyChecking=no "$HOST" \
  "kubectl -n $NS rollout status deploy/$FIG_RELEASE --timeout=300s"

echo "Verifying $FIG_RELEASE /health..."
fig_ok=
for i in 1 2 3 4 5 6; do
  if curl -sf -o /dev/null "http://$FIG_RELEASE.$NS.svc.cluster.local/health"; then
    echo "figure-service prod OK"
    fig_ok=1
    break
  fi
  sleep 5
done
[ -n "$fig_ok" ] || { echo "figure-service prod health check failed" >&2; exit 1; }

# ── QuestionBank (AFTER the figure-service is healthy) ──
RELEASE=questionbank

# Prod tenancy toggle (see QB_PROD_ALLOW_DEFAULT_CUSTOMER in .pipelines/config.yaml).
# Coerce UNSET → "0" (strict) so an unset secret can never mean "allow default
# customer". values-minimal.yaml also baselines this to "0" as defense-in-depth.
ALLOW_DEFAULT="${QB_PROD_ALLOW_DEFAULT_CUSTOMER:-0}"

INPUT_DIR=$(olve_bundle_input)
VERSION=$(cat "$INPUT_DIR/version.txt")

echo "Deploying $RELEASE:$VERSION to prod (minimal profile, QB_ALLOW_DEFAULT_CUSTOMER=$ALLOW_DEFAULT)"

# Materialize the prod LLM key into questionbank-secrets in `apps` (values-minimal.yaml
# mounts it as ANTHROPIC_API_KEY). Fail loud on an unset key — an empty secret would
# let the pod come up healthy but still 502 on grading.
[ -n "$ANTHROPIC_API_KEY" ] || { echo "ANTHROPIC_API_KEY unset" >&2; exit 1; }
ssh -o StrictHostKeyChecking=no "$HOST" \
  "kubectl -n apps create secret generic questionbank-secrets \
     --from-literal=anthropic-api-key='$ANTHROPIC_API_KEY' \
     --dry-run=client -o yaml | kubectl apply -f -"

olve_image_import "$INPUT_DIR/image.tar" "$HOST"

# Verify the image is visible to CRI.
ssh -o StrictHostKeyChecking=no "$HOST" "sudo crictl images | grep $RELEASE"

# Helm upgrade with the MINIMAL values profile. The tenancy toggle is passed at deploy
# time (pipeline-owned), not baked into the chart.
olve_helm_deploy "$HOST" "$RELEASE" apps "$INPUT_DIR/helm" "$VERSION" \
  -f values-minimal.yaml --set config.QB_ALLOW_DEFAULT_CUSTOMER=$ALLOW_DEFAULT

# Wait for the rollout and health-gate the in-cluster Service (minimal prod has no
# ingress, so the Service is the only reachable endpoint).
echo "Waiting for prod rollout..."
ssh -o StrictHostKeyChecking=no "$HOST" \
  "kubectl -n apps rollout status deploy/$RELEASE --timeout=120s"

echo "Verifying prod /api/health..."
for i in 1 2 3 4 5; do
  if curl -sf -o /dev/null http://questionbank.apps.svc.cluster.local/api/health; then
    echo "Deploy complete: $RELEASE:$VERSION"
    exit 0
  fi
  sleep 5
done
echo "Prod health check failed" >&2
exit 1
