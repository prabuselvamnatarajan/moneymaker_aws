#!/bin/sh
# Build all MoneyMaker images and deploy the Kubernetes stack (k3s).
# Thin wrapper over:
#   ./scripts/build-images.sh
#   ./scripts/deploy-k8s.sh
#
# All flags are forwarded to both scripts (each ignores unknown-to-it options
# that the other accepts — see those scripts' --help).
#
# Swarm rollback: ./scripts/deploy-stack.sh still exists but is no longer called here.

set -eu

ROOT="$(CDPATH= cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

chmod +x "$ROOT/scripts/build-images.sh" "$ROOT/scripts/deploy-k8s.sh" 2>/dev/null || true

"$ROOT/scripts/build-images.sh" "$@"
"$ROOT/scripts/deploy-k8s.sh" "$@"
