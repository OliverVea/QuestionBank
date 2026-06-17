#!/bin/sh
# PROCESSING 2: deploy to prod (apps) in the MINIMAL profile. Runs only after
# deploy-beta AND test-after-beta succeed: import the built image into the homelab
# k3s containerd and helm-upgrade the prod release with values-minimal.yaml.
#
# MINIMAL profile (Tier-A decoupling): no public Ingress, no Authentik forward-auth.
# Routing (Cloudflare ingress) and the Authentik auth SYSTEM are owned by the
# separate Olve.Homelab pipeline. This deploy stays self-sufficient and reachable
# in-cluster only.
set -e
apk add --no-cache openssh-client curl
# kubectl runs over ssh on the host; the health curl runs HERE in the job pod —
# only the pod resolves *.svc.cluster.local.

mkdir -p ~/.ssh
echo "$SSH_PRIVATE_KEY" > ~/.ssh/id_ed25519
chmod 600 ~/.ssh/id_ed25519
ssh-keyscan -H bulwark-m2 >> ~/.ssh/known_hosts 2>/dev/null || true

# Two production steps write to /input (packaging + in-code-testing); find the
# packaging bundle by content (the dir with version.txt), not by position.
INPUT_DIR=$(dirname "$(find /input -name version.txt | head -1)")/
VERSION=$(cat "${INPUT_DIR}version.txt")
HOST=oliver@bulwark-m2
RELEASE=questionbank

# Prod tenancy toggle (see QB_PROD_ALLOW_DEFAULT_CUSTOMER in .pipelines/config.yaml).
# Coerce UNSET → "0" (strict) so an unset secret can never mean "allow default
# customer". values-minimal.yaml also baselines this to "0" as defense-in-depth.
ALLOW_DEFAULT="${QB_PROD_ALLOW_DEFAULT_CUSTOMER:-0}"

echo "Deploying $RELEASE:$VERSION to prod (minimal profile, QB_ALLOW_DEFAULT_CUSTOMER=$ALLOW_DEFAULT)"

# Materialize the prod LLM key into questionbank-secrets in `apps` (values-minimal.yaml
# mounts it as ANTHROPIC_API_KEY). Fail loud on an unset key — an empty secret would
# let the pod come up healthy but still 502 on grading.
[ -n "$ANTHROPIC_API_KEY" ] || { echo "ANTHROPIC_API_KEY unset" >&2; exit 1; }
ssh -o StrictHostKeyChecking=no "$HOST" \
  "kubectl -n apps create secret generic questionbank-secrets \
     --from-literal=anthropic-api-key='$ANTHROPIC_API_KEY' \
     --dry-run=client -o yaml | kubectl apply -f -"

# Import the image into k3s containerd (the k3s socket, not the default one).
cat "${INPUT_DIR}image.tar" | ssh -o StrictHostKeyChecking=no "$HOST" \
  "sudo nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io load"

# Verify the image is visible to CRI.
ssh -o StrictHostKeyChecking=no "$HOST" "sudo crictl images | grep $RELEASE"

# Copy the helm chart (clean destination first to avoid scp nesting).
ssh -o StrictHostKeyChecking=no "$HOST" "rm -rf /tmp/$RELEASE-helm"
scp -o StrictHostKeyChecking=no -r "${INPUT_DIR}helm" "$HOST:/tmp/$RELEASE-helm"

# Helm upgrade with the MINIMAL values profile. pullPolicy=Never — the image is
# local to the node. The tenancy toggle is passed at deploy time (pipeline-owned),
# not baked into the chart.
ssh -o StrictHostKeyChecking=no "$HOST" \
  "helm upgrade --install $RELEASE /tmp/$RELEASE-helm -n apps \
     -f /tmp/$RELEASE-helm/values-minimal.yaml \
     --set image.repository=docker.io/library/$RELEASE \
     --set image.tag=$VERSION --set image.pullPolicy=Never \
     --set config.QB_ALLOW_DEFAULT_CUSTOMER=$ALLOW_DEFAULT \
   && rm -rf /tmp/$RELEASE-helm"

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
