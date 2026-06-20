#!/bin/sh
# PROCESSING 3: deploy the figure-service to prod (apps), BEFORE the QB prod deploy
# (which mounts the same figure-service-auth secret and points at this Service).
# Runs only after deploy-figures-beta, deploy-beta and test-after-beta succeed.
set -e

mkdir -p /tmp
wget --no-check-certificate -qO /tmp/olve-lib.sh \
  https://raw.githubusercontent.com/OliverVea/Olve.Pipelines/main/.pipelines/scripts/olve-lib.sh
. /tmp/olve-lib.sh

apk add --no-cache curl

HOST=oliver@bulwark-m2
RELEASE=questionbank-figures
NS=apps

olve_ssh_host bulwark-m2

INPUT_DIR=$(dirname "$(ls /input/*/figures-version.txt | head -1)")
VERSION=$(cat "$INPUT_DIR/figures-version.txt")

echo "Deploying $RELEASE:$VERSION to $NS"

[ -n "$FIGURE_SERVICE_API_KEY" ] || { echo "FIGURE_SERVICE_API_KEY unset" >&2; exit 1; }
ssh -o StrictHostKeyChecking=no "$HOST" \
  "kubectl -n $NS create secret generic figure-service-auth \
     --from-literal=api-key='$FIGURE_SERVICE_API_KEY' \
     --dry-run=client -o yaml | kubectl apply -f -"

olve_image_import "$INPUT_DIR/image.tar" "$HOST"
ssh -o StrictHostKeyChecking=no "$HOST" "sudo crictl images | grep $RELEASE"

olve_helm_deploy "$HOST" "$RELEASE" "$NS" "$INPUT_DIR/helm" "$VERSION"

echo "Waiting for $RELEASE rollout in $NS (heavy image)..."
ssh -o StrictHostKeyChecking=no "$HOST" \
  "kubectl -n $NS rollout status deploy/$RELEASE --timeout=300s"

echo "Verifying $RELEASE /health..."
for i in 1 2 3 4 5 6; do
  if curl -sf -o /dev/null "http://$RELEASE.$NS.svc.cluster.local/health"; then
    echo "figure-service prod OK"
    exit 0
  fi
  sleep 5
done
echo "figure-service prod health check failed" >&2
exit 1
