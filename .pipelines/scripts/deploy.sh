#!/bin/sh
# PROCESSING 2: deploy to prod (apps) in the MINIMAL profile. Runs only after
# deploy-beta AND test-after-beta succeed: import the built image into the homelab
# k3s containerd and helm-upgrade the prod release with values-minimal.yaml.
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

# curl is needed by the in-pod health loop below; olve_ssh_host installs only the ssh
# client. kubectl runs over ssh on the host; the health curl runs HERE in the job pod —
# only the pod resolves *.svc.cluster.local.
apk add --no-cache curl

HOST=oliver@bulwark-m2
RELEASE=questionbank

# Prod tenancy toggle (see QB_PROD_ALLOW_DEFAULT_CUSTOMER in .pipelines/config.yaml).
# Coerce UNSET → "0" (strict) so an unset secret can never mean "allow default
# customer". values-minimal.yaml also baselines this to "0" as defense-in-depth.
ALLOW_DEFAULT="${QB_PROD_ALLOW_DEFAULT_CUSTOMER:-0}"

olve_ssh_host bulwark-m2

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
