#!/usr/bin/env bash
set -euo pipefail

LOS_ANGELES_NODE="${LOS_ANGELES_NODE:-los-angeles-primary}"
LONDON_NODE="${LONDON_NODE:-london-secondary}"
SINGAPORE_NODE="${SINGAPORE_NODE:-singapore-replay}"

log() {
  echo "[SCC-K8S] $1"
}

run_kubectl() {
  kubectl "$@"
}

ensure_namespace() {
  local ns="$1"
  if kubectl get namespace "$ns" >/dev/null 2>&1; then
    log "Namespace exists: $ns"
  else
    log "Creating namespace: $ns"
    run_kubectl create namespace "$ns"
  fi
}

label_node() {
  local node="$1"
  local region="$2"
  local role="$3"
  log "Labeling node $node (region=$region role=$role)"
  run_kubectl label nodes "$node" "region=$region" "role=$role" --overwrite
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log "Step 0: Initialize defensive namespaces"
log "Checking Kubernetes API connectivity"
run_kubectl version --request-timeout=10s >/dev/null

for ns in simulation telemetry fraud-defense replay governance; do
  ensure_namespace "$ns"
done

log "Step 0: Label multi-region nodes"
label_node "$LOS_ANGELES_NODE" "los-angeles" "command"
label_node "$LONDON_NODE" "london" "resilience"
label_node "$SINGAPORE_NODE" "singapore" "simulation"

log "Step 0: Apply defensive namespace manifests"
run_kubectl apply -f "$REPO_ROOT/k8s/namespaces"

log "Step 0: Apply storage/network manifests"
run_kubectl apply -f "$REPO_ROOT/k8s/infrastructure/simulation-storage-network.yaml"

log "Defensive infrastructure initialization complete"
