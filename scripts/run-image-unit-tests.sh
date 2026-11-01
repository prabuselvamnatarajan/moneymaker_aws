#!/bin/sh
# Pull one public image from Docker Hub and run its unit tests inside that image.
#
# Usage:
#   ./scripts/run-image-unit-tests.sh --registry prabuselvamnatarajan --tag sha-0123456789ab --image backtestapp
set -eu

ROOT="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/image-tag.sh"

REGISTRY=""
IMAGE_TAG=""
IMAGE=""

usage() {
  cat <<'EOF'
Usage: run-image-unit-tests.sh --registry NAME --tag TAG --image NAME

Pulls NAME:TAG from the registry and runs npm test inside that image.
The image must contain package.json with a real test script.
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
    *)
      echo "ERROR: Unknown option: $1 (use --help)" >&2
      exit 1
      ;;
  esac
done

if [ -z "$REGISTRY" ] || [ -z "$IMAGE_TAG" ] || [ -z "$IMAGE" ]; then
  echo "ERROR: --registry, --tag, and --image are required" >&2
  exit 1
fi

validate_image_tag "$IMAGE_TAG" "image tag"
validate_image_tag "$IMAGE" "image name"

REMOTE="$REGISTRY/$IMAGE:$IMAGE_TAG"
echo "[unit-tests] Pulling $REMOTE"
docker pull "$REMOTE"

echo "[unit-tests] Running npm test in $REMOTE"
docker run --rm "$REMOTE" sh -c 'set -eu
if [ ! -f package.json ]; then
  echo "ERROR: image has no package.json, so unit tests cannot run" >&2
  exit 1
fi
node -e "const p=require(\"./package.json\"); const t=p.scripts && p.scripts.test; if (!t || String(t).includes(\"no test specified\")) { console.error(\"ERROR: image has no real test script\"); process.exit(1); }"
echo "Running unit tests..."
npm test
'
