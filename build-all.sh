#!/bin/sh
# Build all MoneyMaker images and deploy the Swarm stack.
# Thin wrapper over:
#   ./scripts/build-images.sh
#   ./scripts/deploy-stack.sh
#
# All flags are forwarded to both scripts (each ignores unknown-to-it options
# that the other accepts — see those scripts' --help).

set -eu

ROOT="$(CDPATH= cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

chmod +x "$ROOT/scripts/build-images.sh" "$ROOT/scripts/deploy-stack.sh" 2>/dev/null || true

"$ROOT/scripts/build-images.sh" "$@"
"$ROOT/scripts/deploy-stack.sh" "$@"
