#!/bin/sh
# Tear down the MoneyMaker Kubernetes namespace.
# By default PVCs (Mongo/Redis/shared data) are retained.
# Pass --wipe-data to delete the entire namespace (including PVCs).

set -eu

NAMESPACE=moneymaker
WIPE_DATA=0
# Shared hostPath used by base/dev Mongo bootstrap (see k8s/base/data/mongo*.yaml).
# Survives namespace/PVC deletion and must be cleared on --wipe-data or the next
# deploy skips rs.initiate and ends up with ReplicaSetNoPrimary.
MONGO_INIT_SIGNAL_HOSTPATH=/var/lib/moneymaker/mongo-init-signal

usage() {
  cat <<'EOF'
Usage: kill-moneymaker.sh [--wipe-data]

Removes the moneymaker Kubernetes workloads.

Options:
  --wipe-data   Delete the entire namespace (includes PersistentVolumeClaims)
                and clear the Mongo init-signal hostPath on the node
  --help, -h    Show this help
EOF
}

clear_mongo_init_signal() {
  echo "Clearing Mongo init-signal hostPath ($MONGO_INIT_SIGNAL_HOSTPATH)..."
  if command -v minikube >/dev/null 2>&1 && minikube status >/dev/null 2>&1; then
    minikube ssh -- "sudo rm -rf $MONGO_INIT_SIGNAL_HOSTPATH" || true
    return 0
  fi
  if [ -d "$MONGO_INIT_SIGNAL_HOSTPATH" ] || [ -e "$MONGO_INIT_SIGNAL_HOSTPATH" ]; then
    if [ "$(id -u)" -eq 0 ]; then
      rm -rf "$MONGO_INIT_SIGNAL_HOSTPATH" || true
    elif command -v sudo >/dev/null 2>&1; then
      sudo rm -rf "$MONGO_INIT_SIGNAL_HOSTPATH" || true
    else
      echo "WARNING: cannot clear $MONGO_INIT_SIGNAL_HOSTPATH (need root/sudo)." >&2
      echo "WARNING: next deploy may hit stale Mongo bootstrap — remove that path on the node." >&2
    fi
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --wipe-data)
      WIPE_DATA=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if ! command -v kubectl >/dev/null 2>&1; then
  echo "ERROR: kubectl is not installed or not on PATH." >&2
  exit 1
fi

if ! kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
  echo "Namespace $NAMESPACE does not exist — nothing to remove."
else
  if [ "$WIPE_DATA" = "1" ]; then
    echo "Deleting namespace $NAMESPACE (including PVCs)..."
    kubectl delete namespace "$NAMESPACE" --wait=true
    clear_mongo_init_signal
  else
    echo "Deleting workloads in $NAMESPACE (retaining PVCs)..."
    kubectl -n "$NAMESPACE" delete ingress,job,deployment,statefulset,service,configmap,secret,rolebinding,role,serviceaccount \
      --all --ignore-not-found
    echo "PVCs retained. Use --wipe-data to remove Mongo/Redis/shared volumes."
  fi
fi

echo "Moneymaker stack removed successfully."
