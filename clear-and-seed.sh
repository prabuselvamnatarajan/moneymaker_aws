#!/bin/sh

ROOT="$(CDPATH= cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

NAMESPACE=moneymaker
DEPLOYMENT=backtest-app
SEED_SCRIPT="src/db/clear_and_seed.js"
SKIP_CONFIRM=false

usage() {
  cat <<EOF
Usage: $(basename "$0") [--yes]

Wipe and reseed the BacktestApp MongoDB database in the running Kubernetes stack.

This runs BackTest/BackTestApp/src/db/clear_and_seed.js inside a ${DEPLOYMENT}
pod using the pod's existing environment variables.

Options:
  --yes, -y   Skip confirmation prompt
  --help, -h  Show this help message
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y)
      SKIP_CONFIRM=true
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
  shift
done

if ! command -v kubectl >/dev/null 2>&1; then
  echo "ERROR: kubectl is not installed or not on PATH." >&2
  exit 1
fi

if ! kubectl -n "$NAMESPACE" get deployment "$DEPLOYMENT" >/dev/null 2>&1; then
  echo "ERROR: Deployment ${NAMESPACE}/${DEPLOYMENT} not found." >&2
  echo "Deploy the stack first with: sh build-all.sh" >&2
  exit 1
fi

if [ "$SKIP_CONFIRM" != true ]; then
  echo "WARNING: This will wipe all BacktestApp data:"
  echo "  users, accounts, brokers, strategies, symbols, deployments, trades, ledgers"
  printf "Type 'yes' to continue: "
  read -r reply
  if [ "$reply" != "yes" ]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "Running clear_and_seed.js in deployment/${DEPLOYMENT}..."
kubectl -n "$NAMESPACE" exec "deployment/${DEPLOYMENT}" -- node "$SEED_SCRIPT"
