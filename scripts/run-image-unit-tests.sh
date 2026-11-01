#!/bin/sh
# Pull one public image from Docker Hub and run its unit tests inside that image.
#
# Usage:
#   ./scripts/run-image-unit-tests.sh --registry prabuselvamnatarajan --tag sha-0123456789ab --image backtestapp
#   ./scripts/run-image-unit-tests.sh --all --no-pull --registry prabuselvamnatarajan --tag sha-0123456789ab --parallel 4
set -eu

ROOT="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/image-tag.sh"

REGISTRY=""
IMAGE_TAG=""
IMAGE=""
NO_PULL=0
ALL=0
PARALLEL=""
FAIL=0

usage() {
  cat <<'EOF'
Usage: run-image-unit-tests.sh --registry NAME --tag TAG (--image NAME | --all)

Pulls NAME:TAG from the registry and runs npm test inside that image.
--no-pull uses an image that is already present locally.
--all runs every image whose package.json has a real test script.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
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
    --image)
      [ $# -ge 2 ] || { echo "ERROR: --image requires a value" >&2; exit 1; }
      IMAGE="$2"
      shift 2
      ;;
    --all)
      ALL=1
      shift
      ;;
    --no-pull)
      NO_PULL=1
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

if [ -z "$REGISTRY" ] || [ -z "$IMAGE_TAG" ]; then
  echo "ERROR: --registry and --tag are required" >&2
  exit 1
fi

if [ "$ALL" -eq 1 ] && [ -n "$IMAGE" ]; then
  echo "ERROR: use either --all or --image" >&2
  exit 1
fi

if [ "$ALL" -eq 0 ] && [ -z "$IMAGE" ]; then
  echo "ERROR: --image or --all is required" >&2
  exit 1
fi

validate_image_tag "$IMAGE_TAG" "image tag"

run_one() {
  _image="$1"
  validate_image_tag "$_image" "image name"
  _remote="$REGISTRY/$_image:$IMAGE_TAG"
  if [ "$NO_PULL" -eq 0 ]; then
    echo "[unit-tests] Pulling $_remote"
    docker pull "$_remote"
  elif ! docker image inspect "$_remote" >/dev/null 2>&1; then
    echo "ERROR: local image not found: $_remote" >&2
    return 1
  fi
  echo "[unit-tests] Running npm test in $_remote"
  docker run --rm "$_remote" sh -c 'set -eu
if [ ! -f package.json ]; then
  echo "ERROR: image has no package.json, so unit tests cannot run" >&2
  exit 1
fi
node -e "const p=require(\"./package.json\"); const t=p.scripts && p.scripts.test; if (!t || String(t).includes(\"no test specified\")) { console.error(\"ERROR: image has no real test script\"); process.exit(1); }"
echo "Running unit tests..."
npm test
'
}

if [ "$ALL" -eq 0 ]; then
  run_one "$IMAGE"
  exit 0
fi

IMAGES=$( "$ROOT/scripts/list-unit-test-images.sh" | python3 -c 'import json,sys; print("\n".join(json.load(sys.stdin)))')

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
for _image in $IMAGES; do
  [ -n "$_image" ] || continue
  if [ "$PARALLEL" -eq 1 ]; then
    if ! run_one "$_image"; then
      FAIL=1
      break
    fi
    continue
  fi
  (
    run_one "$_image"
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
  echo "ERROR: one or more image unit test runs failed" >&2
  exit 1
fi
