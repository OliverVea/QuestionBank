#!/bin/sh
# PROCESSING 0: deploy to apps-beta and gate the rest of the chain. Import the
# built image into the homelab k3s containerd, helm-upgrade the beta release with
# beta overrides, then verify the beta rollout is healthy. A failure here stops the
# chain so test-after-beta and prod never run.
set -e
apk add --no-cache openssh-client curl
# Cluster DNS (*.svc.cluster.local) resolves from inside this JOB POD, not from the
# k3s host — so kubectl runs over ssh on the host, but the health curl runs HERE.

mkdir -p ~/.ssh
echo "$SSH_PRIVATE_KEY" > ~/.ssh/id_ed25519
chmod 600 ~/.ssh/id_ed25519
ssh-keyscan -H bulwark-m2 >> ~/.ssh/known_hosts 2>/dev/null || true

# There are now TWO production steps writing to /input (packaging + in-code-testing),
# so `ls -d /input/*/` is ambiguous. Find the packaging bundle by its content
# (the dir containing version.txt) instead of by position.
INPUT_DIR=$(dirname "$(find /input -name version.txt | head -1)")/
VERSION=$(cat "${INPUT_DIR}version.txt")
HOST=oliver@bulwark-m2
RELEASE=questionbank

echo "Deploying $RELEASE:$VERSION to apps-beta"

# Import the image into k3s containerd (the k3s socket, not the default one).
cat "${INPUT_DIR}image.tar" | ssh -o StrictHostKeyChecking=no "$HOST" \
  "sudo nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io load"

# Copy the helm chart (clean destination first to avoid scp nesting).
ssh -o StrictHostKeyChecking=no "$HOST" "rm -rf /tmp/$RELEASE-helm-beta"
scp -o StrictHostKeyChecking=no -r "${INPUT_DIR}helm" "$HOST:/tmp/$RELEASE-helm-beta"

# Helm upgrade with BETA values (values-beta.yaml: Tailscale-only ingress +
# infra-beta-authentik-forward-auth). pullPolicy=Never — the image is local to the
# node. Beta deliberately keeps the auth profile (its ingress injects
# X-authentik-uid); the minimal-profile split applies to PROD, not beta.
ssh -o StrictHostKeyChecking=no "$HOST" \
  "helm upgrade --install $RELEASE /tmp/$RELEASE-helm-beta -n apps-beta \
     -f /tmp/$RELEASE-helm-beta/values-beta.yaml \
     --set image.repository=docker.io/library/$RELEASE \
     --set image.tag=$VERSION --set image.pullPolicy=Never \
   && rm -rf /tmp/$RELEASE-helm-beta"

# Wait for the rollout, then verify reachability — if beta is unhealthy, fail so
# the prod deploy never runs.
echo "Waiting for beta rollout..."
ssh -o StrictHostKeyChecking=no "$HOST" \
  "kubectl -n apps-beta rollout status deploy/$RELEASE --timeout=120s"

# Health-gate the in-cluster Service directly FROM THIS POD (NOT over ssh on the
# host, which can't resolve *.svc.cluster.local; NOT a public hostname, which would
# 401/redirect through the ingress forward-auth). /api/health is open.
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
