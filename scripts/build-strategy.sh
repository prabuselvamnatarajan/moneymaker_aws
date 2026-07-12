#!/bin/sh
set -e

ROOT="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
. "$ROOT/scripts/copy_shared.sh"

STRATEGY_DIR="${1:-}"
IMAGE_TAG="${2:-}"

if [ -z "$STRATEGY_DIR" ]; then
  echo "Usage: $0 <strategy-directory> [image-tag]" >&2
  echo "" >&2
  echo "Examples:" >&2
  echo "  $0 kafka/services/Strategies/liquidity_sweep" >&2
  echo "  $0 kafka/services/Strategies/MSB msb-strategy:latest" >&2
  exit 1
fi

case "$STRATEGY_DIR" in
  /*) ;;
  *) STRATEGY_DIR="$ROOT/$STRATEGY_DIR" ;;
esac

if [ ! -f "$STRATEGY_DIR/Dockerfile" ]; then
  echo "No Dockerfile found in $STRATEGY_DIR" >&2
  exit 1
fi

if [ -z "$IMAGE_TAG" ]; then
  case "$(basename "$STRATEGY_DIR")" in
    MSB) IMAGE_TAG="msb-strategy:latest" ;;
    msb_pts) IMAGE_TAG="msb-pts-strategy:latest" ;;
    liquidity_sweep) IMAGE_TAG="liquidity-sweep-strategy:latest" ;;
    *) IMAGE_TAG="$(basename "$STRATEGY_DIR")-strategy:latest" ;;
  esac
fi

REL_DIR="${STRATEGY_DIR#"$ROOT"/}"
build_strategy "./$REL_DIR" "$IMAGE_TAG"
echo "Built $IMAGE_TAG from $REL_DIR"
