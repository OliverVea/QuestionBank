#!/bin/sh
# PROCESSING 0: deploy the figure-service to apps-beta, BEFORE the QB beta deploy
# (which mounts the same figure-service-auth secret and points at this Service).
# Materialize the shared API key, import the image, helm-upgrade, health-gate.
# A failure here stops the chain (QB beta, prod, etc. never run).
set -e

mkdir -p /tmp
wget --no-check-certificate -qO /tmp/olve-lib.sh \
  https://raw.githubusercontent.com/OliverVea/Olve.Pipelines/main/.pipelines/scripts/olve-lib.sh
. /tmp/olve-lib.sh

apk add --no-cache curl  # in-pod health loop (cluster DNS resolves only from the pod)

HOST=oliver@bulwark-m2
RELEASE=questionbank-figures
NS=apps-beta

olve_ssh_host bulwark-m2

# Select the figure build's bundle dir by its distinct marker (NOT version.txt, which
# is the QB build's selector).
INPUT_DIR=$(dirname "$(ls /input/*/figures-version.txt | head -1)")
VERSION=$(cat "$INPUT_DIR/figures-version.txt")

echo "Deploying $RELEASE:$VERSION to $NS"

# Materialize the shared API key into figure-service-auth (key api-key) in this ns.
# Mounted as FIGURE_SERVICE_API_KEY by BOTH this service and the QB server. Fail loud
# if unset — an empty key would silently DISABLE auth on the service.
[ -n "$FIGURE_SERVICE_API_KEY" ] || { echo "FIGURE_SERVICE_API_KEY unset" >&2; exit 1; }
ssh -o StrictHostKeyChecking=no "$HOST" \
  "kubectl -n $NS create secret generic figure-service-auth \
     --from-literal=api-key='$FIGURE_SERVICE_API_KEY' \
     --dry-run=client -o yaml | kubectl apply -f -"

olve_image_import "$INPUT_DIR/image.tar" "$HOST"
ssh -o StrictHostKeyChecking=no "$HOST" "sudo crictl images | grep $RELEASE"

# No -f override: beta and prod use the chart's values.yaml (in-cluster only).
olve_helm_deploy "$HOST" "$RELEASE" "$NS" "$INPUT_DIR/helm" "$VERSION"

echo "Waiting for $RELEASE rollout in $NS (heavy image)..."
ssh -o StrictHostKeyChecking=no "$HOST" \
  "kubectl -n $NS rollout status deploy/$RELEASE --timeout=300s"

echo "Verifying $RELEASE /health..."
for i in 1 2 3 4 5 6; do
  if curl -sf -o /dev/null "http://$RELEASE.$NS.svc.cluster.local/health"; then
    echo "figure-service beta OK"
    exit 0
  fi
  sleep 5
done
echo "figure-service beta health check failed" >&2
exit 1
