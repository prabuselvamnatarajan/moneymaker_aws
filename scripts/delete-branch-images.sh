#!/bin/sh
# Delete all Docker Hub image tags associated with a deleted git branch.
#
# Usage:
#   ./scripts/delete-branch-images.sh --branch <branch-name>
#   ./scripts/delete-branch-images.sh --branch <branch-name> --registry prabuselvamnatarajan
#   ./scripts/delete-branch-images.sh --branch <branch-name> --dry-run
#   ./scripts/delete-branch-images.sh --help

set -eu

ROOT="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/image-tag.sh"
. "$ROOT/scripts/lib/dockerhub.sh"

BRANCH=""
REGISTRY="${IMAGE_REGISTRY:-prabuselvamnatarajan}"
IMAGE_TAG=""
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: delete-branch-images.sh [options]

Options:
  --branch NAME        Name of the deleted git branch (required unless --tag is given)
  --tag TAG            Specific image tag to delete (overrides --branch resolution)
  --registry NAME      Docker registry namespace (default: prabuselvamnatarajan)
  --dry-run            Show what tags would be deleted without making API requests
  --help               Show this help

Safety:
  Will refuse to delete images for branch 'main' or tag 'latest'.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --branch)
      [ $# -ge 2 ] || { echo "ERROR: --branch requires a value" >&2; exit 1; }
      BRANCH="$2"
      shift 2
      ;;
    --tag)
      [ $# -ge 2 ] || { echo "ERROR: --tag requires a value" >&2; exit 1; }
      IMAGE_TAG="$2"
      shift 2
      ;;
    --registry)
      [ $# -ge 2 ] || { echo "ERROR: --registry requires a value" >&2; exit 1; }
      REGISTRY="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    *)
      echo "ERROR: Unknown option: $1 (use --help)" >&2
      exit 1
      ;;
  esac
done

if [ -z "$BRANCH" ] && [ -z "$IMAGE_TAG" ]; then
  echo "ERROR: --branch or --tag is required (use --help)" >&2
  exit 1
fi

# Strip refs/heads/ prefix if provided
if [ -n "$BRANCH" ]; then
  BRANCH="${BRANCH#refs/heads/}"
  if [ "$BRANCH" = "main" ]; then
    printf '[delete-branch-images] Skipping: branch is main (will not delete production images)\n'
    exit 0
  fi
  if [ -z "$IMAGE_TAG" ]; then
    IMAGE_TAG=$(branch_destination_tag "$BRANCH")
  fi
fi

if [ "$IMAGE_TAG" = "latest" ]; then
  echo "ERROR: tag is 'latest'; refusing to delete production images" >&2
  exit 1
fi

validate_image_tag "$IMAGE_TAG" "image tag"

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
timeframe-constructor:latest
stream-to-client:latest
msb-strategy:latest
msb-pts-strategy:latest
liquidity-sweep-strategy:latest
"

if [ "$DRY_RUN" -eq 1 ]; then
  printf '[delete-branch-images] DRY-RUN: would delete tag %s from registry %s for images:\n' "$IMAGE_TAG" "$REGISTRY"
  for _item in $CUSTOM_IMAGES_FULL; do
    [ -n "$_item" ] || continue
    _repo=$(printf '%s' "$_item" | cut -d: -f1)
    printf '  - %s/%s:%s\n' "$REGISTRY" "$_repo" "$IMAGE_TAG"
  done
  exit 0
fi

if [ -z "${DOCKERHUB_TOKEN:-}" ]; then
  echo "ERROR: DOCKERHUB_TOKEN environment variable is required to delete tags from Docker Hub" >&2
  exit 1
fi

printf '[delete-branch-images] Authenticating with Docker Hub for user %s...\n' "$REGISTRY"
JWT=$(dockerhub_api_token "$REGISTRY")

printf '[delete-branch-images] Starting deletion of tag %s across all repositories in %s...\n' "$IMAGE_TAG" "$REGISTRY"

DELETED_COUNT=0
NOT_FOUND_COUNT=0
FAILED_COUNT=0

for _item in $CUSTOM_IMAGES_FULL; do
  [ -n "$_item" ] || continue
  _repo=$(printf '%s' "$_item" | cut -d: -f1)

  _res=""
  if _res=$(dockerhub_delete_tag "$REGISTRY" "$_repo" "$IMAGE_TAG" "$JWT"); then
    if [ "$_res" = "deleted" ]; then
      printf '[delete-branch-images] Deleted: %s/%s:%s\n' "$REGISTRY" "$_repo" "$IMAGE_TAG"
      DELETED_COUNT=$((DELETED_COUNT + 1))
    else
      printf '[delete-branch-images] Not found (already absent): %s/%s:%s\n' "$REGISTRY" "$_repo" "$IMAGE_TAG"
      NOT_FOUND_COUNT=$((NOT_FOUND_COUNT + 1))
    fi
  else
    printf '[delete-branch-images] FAILED: %s/%s:%s\n' "$REGISTRY" "$_repo" "$IMAGE_TAG" >&2
    FAILED_COUNT=$((FAILED_COUNT + 1))
  fi
done

printf '[delete-branch-images] Summary for tag "%s": %d deleted, %d not found, %d failed\n' \
  "$IMAGE_TAG" "$DELETED_COUNT" "$NOT_FOUND_COUNT" "$FAILED_COUNT"

if [ "$FAILED_COUNT" -gt 0 ]; then
  echo "ERROR: failed to delete $FAILED_COUNT image tag(s)" >&2
  exit 1
fi

exit 0
