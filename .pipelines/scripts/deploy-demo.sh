#!/bin/sh
# deploy-demo — the PUBLIC demo (release questionbank-demo, namespace apps).
#
# Runs LAST, after prod, so a demo failure can never block a prod deploy. Same image as
# prod, started with QB_DEMO=1 by helm/values-demo.yaml: guest tenants, no login, and no
# secrets mounted. The public route (questionbank-demo.ovea.pro) is owned by Olve.Homelab.
set -e

mkdir -p /tmp
wget --no-check-certificate -qO /tmp/olve-lib.sh \
  https://raw.githubusercontent.com/OliverVea/Olve.Pipelines/main/.pipelines/scripts/olve-lib.sh
. /tmp/olve-lib.sh

apk add --no-cache curl

HOST=oliver@bulwark-m2
NS=apps
RELEASE=questionbank-demo

olve_ssh_host bulwark-m2

INPUT_DIR=$(olve_bundle_input)
VERSION=$(cat "$INPUT_DIR/version.txt")

echo "Deploying $RELEASE:$VERSION to $NS (public demo profile)"

# Idempotent: the prod step imported this image already; importing again keeps this step
# able to run on its own.
olve_image_import "$INPUT_DIR/image.tar" "$HOST"

# Not olve_helm_deploy: it sets the image repository to the RELEASE name, and the demo runs
# the prod image (questionbank) under another release name (questionbank-demo).
REMOTE_CHART="/tmp/$RELEASE-helm-$NS"
ssh -o StrictHostKeyChecking=no "$HOST" "rm -rf $REMOTE_CHART"
scp -o StrictHostKeyChecking=no -r "$INPUT_DIR/helm" "$HOST:$REMOTE_CHART"
ssh -o StrictHostKeyChecking=no "$HOST" \
  "cd $REMOTE_CHART && helm upgrade --install $RELEASE . -n $NS -f values-demo.yaml \
     --set image.repository=docker.io/library/questionbank \
     --set image.tag=$VERSION --set image.pullPolicy=Never \
   && cd / && rm -rf $REMOTE_CHART"

echo "Waiting for demo rollout..."
ssh -o StrictHostKeyChecking=no "$HOST" \
  "kubectl -n $NS rollout status deploy/$RELEASE --timeout=120s"

# The demo is public, so it must hold no credentials. Fail the step if any appear.
if ssh -o StrictHostKeyChecking=no "$HOST" \
     "kubectl -n $NS exec deploy/$RELEASE -- env" | grep -q -E '^(ANTHROPIC_API_KEY|FIGURE_SERVICE_API_KEY)='; then
  echo "demo pod has a credential in its environment" >&2
  exit 1
fi

echo "Verifying demo /api/health reports demo mode..."
for i in 1 2 3 4 5; do
  if curl -sf "http://$RELEASE.$NS.svc.cluster.local/api/health" | grep -q '"mode":"demo"'; then
    echo "Demo deploy complete: $RELEASE:$VERSION"
    exit 0
  fi
  sleep 5
done

echo "Demo health check failed" >&2
exit 1
