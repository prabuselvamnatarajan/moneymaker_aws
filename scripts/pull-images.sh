#!/bin/sh
# Pull MoneyMaker Docker images from a registry and tag them for local Kubernetes use.
#
# Usage:
#   ./scripts/pull-images.sh --registry prabuselvamnatarajan --tag latest
#   ./scripts/pull-images.sh --profile e2e --registry prabuselvamnatarajan --tag main
#   ./scripts/pull-images.sh --help

set -eu

# Parallel pulls use bash job control if available
if [ -z "${BASH_VERSION:-}" ] && [ "${_PULL_IMAGES_BASH:-0}" != "1" ]; then
  if command -v bash >/dev/null 2>&1; then
    _PULL_IMAGES_BASH=1 exec bash "$0" "$@"
  fi
fi

ROOT="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/image-tag.sh"

PROFILE="e2e"
REGISTRY="prabuselvamnatarajan"
IMAGE_TAG="latest"
PUSH_TAG=""
ALLOW_LATEST=0
PARALLEL=""
FAIL=0

usage() {
  cat <<'EOF'
Usage: pull-images.sh [options]

Options:
  --profile full|e2e   Image set to pull (default: e2e)
  --registry NAME      Docker registry prefix (default: prabuselvamnatarajan)
  --tag TAG            Image tag to pull (default: latest)
  --push-tag TAG       After a successful pull, push the same images as TAG
  --allow-latest       Permit --push-tag latest (production promotion only)
  --parallel N         Pull up to N images concurrently (default: 1 local, 4 in CI)
  --help               Show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --profile)
      [ $# -ge 2 ] || { echo "ERROR: --profile requires full|e2e" >&2; exit 1; }
      PROFILE="$2"
      shift 2
      ;;
    --registry)
      [ $# -ge 2 ] || { echo "ERROR: --registry requires a value" >&2; exit 1; }
      REGISTRY="$2"
      shift 2
      ;;
    --tag)
      [ $# -ge 2 ] || { echo "ERROR: --tag requires a value" >&2; exit 1; }
      IMAGE_TAG="$2"
      shift 2
      ;;
    --push-tag)
      [ $# -ge 2 ] || { echo "ERROR: --push-tag requires a value" >&2; exit 1; }
      PUSH_TAG="$2"
      shift 2
      ;;
    --allow-latest)
      ALLOW_LATEST=1
      shift
      ;;
    --parallel)
      [ $# -ge 2 ] || { echo "ERROR: --parallel requires a number" >&2; exit 1; }
      PARALLEL="$2"
      shift 2
      ;;
    *)
      echo "ERROR: Unknown option: $1 (use --help)" >&2
      exit 1
      ;;
  esac
done

if [ -z "$PARALLEL" ]; then
  if [ "${CI:-}" = "true" ]; then
    PARALLEL=4
  else
    PARALLEL=1
  fi
fi

case "$PARALLEL" in
  ''|*[!0-9]*|0)
    echo "ERROR: --parallel must be a positive integer (got: $PARALLEL)" >&2
    exit 1
    ;;
esac

case "$PROFILE" in
  full|e2e) ;;
  *)
    echo "ERROR: --profile must be full or e2e (got: $PROFILE)" >&2
    exit 1
    ;;
esac

validate_image_tag "$IMAGE_TAG" "image tag"

if [ -n "$PUSH_TAG" ]; then
  validate_image_tag "$PUSH_TAG" "push tag"
  if [ "$PUSH_TAG" = "latest" ] && [ "$ALLOW_LATEST" -ne 1 ]; then
    echo "ERROR: refusing to push :latest without --allow-latest" >&2
    exit 1
  fi
fi

log() {
  printf '[pull-images] %s\n' "$*"
}

CUSTOM_IMAGES_E2E="
appinit:latest
backtestapp:latest
backtestui:latest
"

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

if [ "$PROFILE" = "e2e" ]; then
  IMAGES="$CUSTOM_IMAGES_E2E"
else
  IMAGES="$CUSTOM_IMAGES_FULL"
fi

pull_and_tag_one() {
  _local_tag="$1"
  _base_name=$(printf '%s' "$_local_tag" | cut -d: -f1)
  _remote_tag="$REGISTRY/$_base_name:$IMAGE_TAG"
  log "Pulling $_remote_tag"
  docker pull "$_remote_tag"
  log "Tagging $_remote_tag -> $_local_tag"
  docker tag "$_remote_tag" "$_local_tag"
}

PIDS=""
ACTIVE=0

flush_batch() {
  _save_ifs="$IFS"
  IFS=' '
  for _pid in $PIDS; do
    [ -n "$_pid" ] || continue
    if ! wait "$_pid"; then
      FAIL=1
    fi
  done
  IFS="$_save_ifs"
  PIDS=""
  ACTIVE=0
}

OLD_IFS="$IFS"
IFS='
'
for _img in $IMAGES; do
  [ -n "$_img" ] || continue
  if [ "$PARALLEL" -eq 1 ]; then
    if ! pull_and_tag_one "$_img"; then
      FAIL=1
      break
    fi
    continue
  fi

  (
    pull_and_tag_one "$_img"
  ) &
  PIDS="$PIDS $!"
  ACTIVE=$((ACTIVE + 1))
  if [ "$ACTIVE" -ge "$PARALLEL" ]; then
    flush_batch
    if [ "$FAIL" -ne 0 ]; then
      break
    fi
  fi
done
IFS="$OLD_IFS"

if [ -n "$PIDS" ]; then
  flush_batch
fi

if [ "$FAIL" -ne 0 ]; then
  log "ERROR: one or more image pulls failed"
  exit 1
fi

log "All images pulled and tagged (profile=$PROFILE registry=$REGISTRY tag=$IMAGE_TAG)"

if [ -z "$PUSH_TAG" ] || [ "$PUSH_TAG" = "$IMAGE_TAG" ]; then
  exit 0
fi

log "Promoting $REGISTRY/*:$IMAGE_TAG -> $REGISTRY/*:$PUSH_TAG"
PIDS=""
ACTIVE=0
OLD_IFS="$IFS"
IFS='
'
for _img in $IMAGES; do
  [ -n "$_img" ] || continue
  _base_name=$(printf '%s' "$_img" | cut -d: -f1)
  _src="$REGISTRY/$_base_name:$IMAGE_TAG"
  _dest="$REGISTRY/$_base_name:$PUSH_TAG"
  if [ "$PARALLEL" -eq 1 ]; then
    log "Pushing $_dest"
    docker tag "$_src" "$_dest"
    if ! docker push "$_dest"; then
      FAIL=1
      break
    fi
    continue
  fi

  (
    log "Pushing $_dest"
    docker tag "$_src" "$_dest"
    docker push "$_dest"
  ) &
  PIDS="$PIDS $!"
  ACTIVE=$((ACTIVE + 1))
  if [ "$ACTIVE" -ge "$PARALLEL" ]; then
    flush_batch
    if [ "$FAIL" -ne 0 ]; then
      break
    fi
  fi
done
IFS="$OLD_IFS"

if [ -n "$PIDS" ]; then
  flush_batch
fi

if [ "$FAIL" -ne 0 ]; then
  log "ERROR: one or more image promotions failed"
  exit 1
fi

log "Promoted images to $REGISTRY/*:$PUSH_TAG"
exit 0
