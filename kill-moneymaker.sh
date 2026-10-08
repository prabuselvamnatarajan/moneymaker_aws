#!/bin/sh
# Tear down the MoneyMaker Kubernetes namespace.
# By default PVCs (Mongo/Redis/shared data) are retained.
# Pass --wipe-data to delete the entire namespace (including PVCs).

set -eu

NAMESPACE=moneymaker
WIPE_DATA=0

usage() {
  cat <<'EOF'
Usage: kill-moneymaker.sh [--wipe-data]

Removes the moneymaker Kubernetes workloads.

Options:
  --wipe-data   Delete the entire namespace (includes PersistentVolumeClaims)
  --help, -h    Show this help
EOF
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
  else
    echo "Deleting workloads in $NAMESPACE (retaining PVCs)..."
    kubectl -n "$NAMESPACE" delete ingress,job,deployment,statefulset,service,configmap,secret,rolebinding,role,serviceaccount \
      --all --ignore-not-found
    echo "PVCs retained. Use --wipe-data to remove Mongo/Redis/shared volumes."
  fi
fi

echo "Moneymaker stack removed successfully."
