#!/bin/sh
# Install k3s if needed, import local Docker images into the cluster,
# and apply MoneyMaker Kubernetes manifests.
#
# Usage:
#   ./scripts/deploy-k8s.sh
#   ./scripts/deploy-k8s.sh --overlay ci
#   ./scripts/deploy-k8s.sh --overlay full --no-import
#   ./scripts/deploy-k8s.sh --overlay dev
#   ./scripts/deploy-k8s.sh --overlay prod --no-import
#   ./scripts/deploy-k8s.sh --help
#
# Also accepts (ignored) build-images flags so build-all.sh can forward a shared argv:
#   --profile ...  --parallel ...

set -eu

ROOT="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OVERLAY="full"
NO_IMPORT=0
DETACH=""
NAMESPACE=moneymaker

usage() {
  cat <<'EOF'
Usage: deploy-k8s.sh [options]

Options:
  --overlay full|ci|dev|prod
                       Kustomize overlay to apply (default: full)
                         full  — local k3s (install if missing)
                         ci    — E2E subset on k3s/minikube
                         dev   — minikube only (nginx Ingress, algo.mrcobra.link)
                         prod  — apply-only against the current kube context (EKS)
  --no-import          Skip importing local Docker images into the cluster
  --detach             Do not wait for Deployments/StatefulSets (CI default when CI=true)
  --no-detach          Wait for core workloads to become Ready (default locally)
  --help               Show this help

Also accepts (ignored) build-images flags so build-all.sh can forward a shared argv:
  --profile ...  --parallel ...  --no-pull

Examples:
  ./scripts/deploy-k8s.sh
  ./scripts/deploy-k8s.sh --overlay ci --detach
  ./scripts/deploy-k8s.sh --overlay dev
  ./scripts/deploy-k8s.sh --overlay prod --no-import
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --overlay)
      [ $# -ge 2 ] || { echo "ERROR: --overlay requires full|ci|dev|prod" >&2; exit 1; }
      OVERLAY="$2"
      shift 2
      ;;
    --no-import)
      NO_IMPORT=1
      shift
      ;;
    --detach)
      DETACH=true
      shift
      ;;
    --no-detach)
      DETACH=false
      shift
      ;;
    --compose)
      echo "ERROR: Docker Swarm compose deploy was removed. Use --overlay ci|full|dev|prod." >&2
      exit 1
      ;;
    --no-pull|--push)
      shift
      ;;
    --profile|--parallel|--registry|--tag)
      [ $# -ge 2 ] || { echo "ERROR: $1 requires a value" >&2; exit 1; }
      shift 2
      ;;
    *)
      echo "ERROR: Unknown option: $1 (use --help)" >&2
      exit 1
      ;;
  esac
done

case "$OVERLAY" in
  full|ci|dev|prod) ;;
  *)
    echo "ERROR: --overlay must be full, ci, dev, or prod (got: $OVERLAY)" >&2
    exit 1
    ;;
esac

if [ -z "$DETACH" ]; then
  if [ "${CI:-}" = "true" ]; then
    DETACH=true
  else
    DETACH=false
  fi
fi

log() {
  printf '[deploy-k8s] %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "ERROR: required command not found: $1"
    exit 1
  fi
}

sync_k8s_files() {
  # Keep kustomize-local copies in sync with source certs / mongo keyfile.
  mkdir -p "$ROOT/k8s/base/files" "$ROOT/k8s/overlays/ci/files"
  cp -f "$ROOT/mongo/mongo-keyfile" "$ROOT/k8s/base/files/mongo-keyfile"
  cp -f "$ROOT/certs/self-signed.crt" "$ROOT/k8s/base/files/tls.crt"
  cp -f "$ROOT/certs/self-signed.key" "$ROOT/k8s/base/files/tls.key"
  cp -f "$ROOT/certs/nginx.conf" "$ROOT/k8s/base/files/nginx.conf"
  cp -f "$ROOT/certs/nginx.ci.k8s.conf" "$ROOT/k8s/overlays/ci/files/nginx.conf"
}

ensure_minikube() {
  require_cmd minikube
  if ! minikube status >/dev/null 2>&1; then
    log "ERROR: overlay=dev requires a running minikube cluster (minikube start)"
    exit 1
  fi
  log "Using minikube cluster for overlay=dev"
  if ! kubectl cluster-info >/dev/null 2>&1; then
    log "ERROR: kubectl cannot reach the minikube API (check kube context: minikube)"
    exit 1
  fi
}

ensure_cluster() {
  # prod: apply against the caller's current kube context (EKS). Never install k3s.
  if [ "$OVERLAY" = "prod" ]; then
    require_cmd kubectl
    if ! kubectl cluster-info >/dev/null 2>&1; then
      log "ERROR: overlay=prod requires a reachable cluster (configure kubeconfig for EKS first)"
      exit 1
    fi
    log "Kubernetes cluster is reachable (prod apply-only)"
    return 0
  fi

  # dev: minikube only — do not install k3s.
  if [ "$OVERLAY" = "dev" ]; then
    ensure_minikube
    return 0
  fi

  if command -v kubectl >/dev/null 2>&1 && kubectl cluster-info >/dev/null 2>&1; then
    log "Kubernetes cluster is reachable"
    return 0
  fi

  if [ "$(id -u)" -ne 0 ] && ! command -v sudo >/dev/null 2>&1; then
    log "ERROR: no working kubectl cluster and cannot install k3s (need root/sudo)"
    exit 1
  fi

  if ! command -v k3s >/dev/null 2>&1; then
    log "Installing k3s (single-node Kubernetes)..."
    if [ "$(id -u)" -eq 0 ]; then
      curl -sfL https://get.k3s.io | sh -
    else
      curl -sfL https://get.k3s.io | sudo sh -
    fi
  fi

  # Wait for k3s.yaml to be created by the service
  _w=0
  while [ ! -f /etc/rancher/k3s/k3s.yaml ] && [ "$_w" -lt 30 ]; do
    _w=$((_w + 1))
    sleep 2
  done

  # Wire kubectl to k3s kubeconfig for the current user and ensure readable permissions
  if [ -f /etc/rancher/k3s/k3s.yaml ]; then
    if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
      sudo chmod 644 /etc/rancher/k3s/k3s.yaml || true
    fi
    mkdir -p "$HOME/.kube"
    if [ "$(id -u)" -eq 0 ]; then
      cp /etc/rancher/k3s/k3s.yaml "$HOME/.kube/config"
    else
      sudo cp /etc/rancher/k3s/k3s.yaml "$HOME/.kube/config"
      sudo chown "$(id -u):$(id -g)" "$HOME/.kube/config"
    fi
    chmod 600 "$HOME/.kube/config"
    export KUBECONFIG="$HOME/.kube/config"
  fi

  # Wait briefly for the API
  _i=0
  while [ "$_i" -lt 60 ]; do
    if kubectl cluster-info >/dev/null 2>&1; then
      log "k3s is ready"
      return 0
    fi
    _i=$((_i + 1))
    sleep 2
  done
  log "ERROR: k3s API did not become ready"
  exit 1
}

# Custom images imported from the local Docker daemon.
# CI and AWS load these by pulling them from Docker Hub first (scripts/pull-images.sh).
CUSTOM_IMAGES_FULL="
appinit:latest
upstock-login:latest
connect-upstox-web-socket:latest
get-ltp:latest
get-ohlc:latest
get-fullmarketquote:latest
placeorder:latest
get-orderbook:latest
get-put-call-option-chain:latest
get-option-contracts:latest
get-funds-and-margin:latest
wsdatasplitterconsumer:latest
storer-consumer:latest
strategy-chooser-consumer:latest
position-tracker-consumer:latest
deployment-symbol-resolver-consumer:latest
backteststreamer:latest
backtestclient:latest
backtestapp:latest
backtestui:latest
exporttofile:latest
stream-to-client:latest
msb-strategy:latest
msb-pts-strategy:latest
liquidity-sweep-strategy:latest
"

CUSTOM_IMAGES_E2E="
appinit:latest
backtestapp:latest
backtestui:latest
"

import_images() {
  # Prod pulls from a registry; never load local Docker images into EKS.
  if [ "$OVERLAY" = "prod" ]; then
    log "Skipping image import (overlay=prod — images must already be in the cluster/registry)"
    return 0
  fi

  if [ "$NO_IMPORT" = "1" ]; then
    log "Skipping image import (--no-import)"
    return 0
  fi

  require_cmd docker

  if [ "$OVERLAY" = "ci" ]; then
    _images="$CUSTOM_IMAGES_E2E"
  else
    _images="$CUSTOM_IMAGES_FULL"
  fi

  _fail=0

  # Prefer minikube when the overlay is dev, or when minikube is the reachable cluster.
  if [ "$OVERLAY" = "dev" ] || { command -v minikube >/dev/null 2>&1 && minikube status >/dev/null 2>&1 && ! command -v k3s >/dev/null 2>&1; }; then
    log "Loading local Docker images into minikube"
    for _img in $_images; do
      [ -n "$_img" ] || continue
      if ! docker image inspect "$_img" >/dev/null 2>&1; then
        log "ERROR: image not found locally (pull or build it first): $_img"
        _fail=1
        continue
      fi
      log "minikube image load $_img"
      if ! minikube image load "$_img"; then
        _fail=1
      fi
    done
  elif command -v k3s >/dev/null 2>&1; then
    log "Importing local Docker images into k3s containerd"
    for _img in $_images; do
      [ -n "$_img" ] || continue
      if ! docker image inspect "$_img" >/dev/null 2>&1; then
        log "ERROR: image not found locally (pull or build it first): $_img"
        _fail=1
        continue
      fi
      log "Import $_img"
      if [ "$(id -u)" -eq 0 ]; then
        if ! docker save "$_img" | k3s ctr images import -; then
          _fail=1
        fi
      else
        if ! docker save "$_img" | sudo k3s ctr images import -; then
          _fail=1
        fi
      fi
    done
  elif command -v minikube >/dev/null 2>&1 && minikube status >/dev/null 2>&1; then
    log "Loading local Docker images into minikube"
    for _img in $_images; do
      [ -n "$_img" ] || continue
      if ! docker image inspect "$_img" >/dev/null 2>&1; then
        log "ERROR: image not found locally (pull or build it first): $_img"
        _fail=1
        continue
      fi
      log "minikube image load $_img"
      if ! minikube image load "$_img"; then
        _fail=1
      fi
    done
  else
    log "WARNING: neither k3s nor minikube available for image import — cluster must already have the images"
    return 0
  fi

  if [ "$_fail" -ne 0 ]; then
    log "ERROR: one or more image imports failed"
    exit 1
  fi
  log "Image import complete"
}

ensure_metrics() {
  if [ "$OVERLAY" = "prod" ]; then
    return 0
  fi
  # HPA reads CPU/memory from metrics-server. k3s ships it; minikube does not.
  if command -v minikube >/dev/null 2>&1 && minikube status >/dev/null 2>&1; then
    if ! minikube addons list 2>/dev/null | grep -q 'metrics-server.*enabled'; then
      log "Enabling minikube metrics-server addon (required for HPA)..."
      minikube addons enable metrics-server || true
    fi
  fi
  if kubectl get apiservice v1beta1.metrics.k8s.io >/dev/null 2>&1; then
    log "metrics-server API is registered"
  else
    log "WARNING: metrics.k8s.io is not available — HPA cannot read CPU/memory until metrics-server is running"
  fi
}

ensure_ingress() {
  # prod Ingress class (alb) is set by the overlay — do not rewrite after apply.
  if [ "$OVERLAY" = "prod" ]; then
    export MM_INGRESS_CLASS=""
    return 0
  fi
  # dev / minikube: enable the nginx Ingress controller when missing
  if [ "$OVERLAY" = "dev" ] || { command -v minikube >/dev/null 2>&1 && minikube status >/dev/null 2>&1; }; then
    if command -v minikube >/dev/null 2>&1 && minikube status >/dev/null 2>&1; then
      if ! kubectl get ingressclass nginx >/dev/null 2>&1; then
        log "Enabling minikube ingress addon..."
        minikube addons enable ingress || true
        _i=0
        while [ "$_i" -lt 60 ]; do
          if kubectl get ingressclass nginx >/dev/null 2>&1; then
            break
          fi
          _i=$((_i + 1))
          sleep 2
        done
      fi
      if kubectl get configmap ingress-nginx-controller -n ingress-nginx >/dev/null 2>&1; then
        kubectl -n ingress-nginx patch configmap ingress-nginx-controller --type=merge \
          -p '{"data":{"use-forwarded-headers":"true"}}' >/dev/null 2>&1 || true
      fi
    fi
    # full/ci on minikube still retarget Traefik → nginx after apply.
    # dev overlay already sets ingressClassName=nginx — skip the post-apply patch.
    if [ "$OVERLAY" = "dev" ]; then
      export MM_INGRESS_CLASS=""
    else
      export MM_INGRESS_CLASS=nginx
    fi
  elif kubectl get ingressclass traefik >/dev/null 2>&1; then
    export MM_INGRESS_CLASS=traefik
  else
    export MM_INGRESS_CLASS=""
  fi
}

patch_ingress_class() {
  if [ -z "${MM_INGRESS_CLASS:-}" ]; then
    return 0
  fi
  if [ "$MM_INGRESS_CLASS" = "traefik" ]; then
    return 0
  fi
  log "Setting Ingress class to $MM_INGRESS_CLASS"
  kubectl -n "$NAMESPACE" patch ingress moneymaker --type=merge \
    -p "{\"spec\":{\"ingressClassName\":\"$MM_INGRESS_CLASS\"}}" >/dev/null 2>&1 || true
}

recreate_appinit_job() {
  # Jobs are immutable; delete any previous appinit Job so apply can recreate it.
  if [ "$OVERLAY" = "ci" ]; then
    return 0
  fi
  kubectl -n "$NAMESPACE" delete job appinit --ignore-not-found >/dev/null 2>&1 || true
}

wait_for_core() {
  log "Waiting for core workloads in namespace $NAMESPACE"
  kubectl -n "$NAMESPACE" rollout status deployment/reverse-proxy --timeout=300s || true
  kubectl -n "$NAMESPACE" rollout status deployment/backtest-app --timeout=600s || true
  kubectl -n "$NAMESPACE" rollout status deployment/backtest-ui --timeout=300s || true
  # StatefulSets: wait until mongo1 has a ready replica (best-effort)
  _i=0
  while [ "$_i" -lt 90 ]; do
    _ready=$(kubectl -n "$NAMESPACE" get statefulset mongo1 -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo 0)
    if [ "${_ready:-0}" = "1" ]; then
      log "mongo1 is ready"
      break
    fi
    _i=$((_i + 1))
    sleep 5
  done
}

# --- main ---
# prod does not need local Docker (images come from a registry).
if [ "$OVERLAY" != "prod" ]; then
  require_cmd docker
fi
sync_k8s_files
ensure_cluster
require_cmd kubectl
ensure_metrics
ensure_ingress
import_images
recreate_appinit_job

OVERLAY_PATH="$ROOT/k8s/overlays/$OVERLAY"
if [ ! -f "$OVERLAY_PATH/kustomization.yaml" ]; then
  log "ERROR: overlay not found: $OVERLAY_PATH"
  exit 1
fi

log "Applying kustomize overlay: $OVERLAY"
kubectl apply -k "$OVERLAY_PATH"
patch_ingress_class

if [ "$DETACH" = "true" ]; then
  log "Deploy finished (detach=true — not waiting for readiness)"
else
  wait_for_core
  log "Deploy finished"
fi
exit 0
