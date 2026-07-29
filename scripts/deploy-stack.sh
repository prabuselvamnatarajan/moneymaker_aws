#!/bin/sh
# Initialize Docker Swarm (if needed) and deploy the MoneyMaker stack.
# Expects images to already exist (see scripts/build-images.sh).
#
# Usage:
#   ./scripts/deploy-stack.sh
#   ./scripts/deploy-stack.sh --detach
#   ./scripts/deploy-stack.sh --compose docker-compose.ci.yml
#   ./scripts/deploy-stack.sh --help

set -eu

ROOT="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DETACH=""
NO_PULL=0
COMPOSE_EXTRA=""
STACK_NAME=moneymaker

usage() {
  cat <<'EOF'
Usage: deploy-stack.sh [options]

Options:
  --detach             Return immediately after stack deploy (CI default when CI=true)
  --no-detach          Wait for Swarm service convergence (default locally / AWS)
  --compose FILE       Extra compose override (e.g. docker-compose.ci.yml); can repeat
  --no-pull            Skip pre-pull of external base images
  --help               Show this help

Also accepts (ignored) build-images flags so build-all.sh can forward a shared argv:
  --profile ...  --parallel ...

Examples:
  ./scripts/deploy-stack.sh
  ./scripts/deploy-stack.sh --detach --compose docker-compose.ci.yml
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --detach)
      DETACH=true
      shift
      ;;
    --no-detach)
      DETACH=false
      shift
      ;;
    --compose)
      [ $# -ge 2 ] || { echo "ERROR: --compose requires a file path" >&2; exit 1; }
      COMPOSE_EXTRA="$COMPOSE_EXTRA $2"
      shift 2
      ;;
    --no-pull)
      NO_PULL=1
      shift
      ;;
    --profile|--parallel)
      [ $# -ge 2 ] || { echo "ERROR: $1 requires a value" >&2; exit 1; }
      shift 2
      ;;
    *)
      echo "ERROR: Unknown option: $1 (use --help)" >&2
      exit 1
      ;;
  esac
done

if [ -z "$DETACH" ]; then
  if [ "${CI:-}" = "true" ]; then
    DETACH=true
  else
    DETACH=false
  fi
fi

log() {
  printf '[deploy-stack] %s\n' "$*"
}

# External images referenced by docker-compose.yml (not built by build-images.sh).
EXTERNAL_IMAGES="
bitnamilegacy/zookeeper:latest
bitnamilegacy/kafka:3.4.1
mongo:6.0
mongo-express:latest
redis/redis-stack:latest
redislabs/redisinsight:1.14.0
nginx:latest
"

pre_pull_images() {
  if [ "$NO_PULL" = "1" ]; then
    log "Skipping external image pre-pull (--no-pull)"
    return 0
  fi

  log "Pre-pulling external base images (parallel)"
  _pids=""
  _fail=0
  for _img in $EXTERNAL_IMAGES; do
    [ -n "$_img" ] || continue
    (
      log "Pull $_img"
      docker pull "$_img"
    ) &
    _pids="$_pids $!"
  done
  for _pid in $_pids; do
    if ! wait "$_pid"; then
      _fail=1
    fi
  done
  if [ "$_fail" -ne 0 ]; then
    log "ERROR: one or more docker pull commands failed"
    exit 1
  fi
  log "External image pre-pull complete"
}

if ! docker info 2>/dev/null | grep -q "Swarm: active"; then
  log "Initializing Docker Swarm..."
  docker swarm init --advertise-addr 127.0.0.1 2>/dev/null || docker swarm init
  log "Waiting for Swarm network control plane..."
  sleep 3
fi

. "$ROOT/scripts/ensure_swarm_deploy_ready.sh"
ensure_swarm_deploy_ready

pre_pull_images

# When any compose extra looks like the CI overlay, default to the minimal nginx config
# unless the caller already set NGINX_CONF.
case " $COMPOSE_EXTRA " in
  *"docker-compose.ci.yml"*)
    if [ -z "${NGINX_CONF:-}" ]; then
      export NGINX_CONF=./certs/nginx.ci.conf
    fi
    ;;
esac

if [ -n "${NGINX_CONF:-}" ]; then
  if [ ! -f "$NGINX_CONF" ] && [ ! -f "$ROOT/$NGINX_CONF" ]; then
    log "ERROR: NGINX_CONF file not found: $NGINX_CONF"
    exit 1
  fi
  log "Using NGINX_CONF=$NGINX_CONF"
fi

log "Deploying stack '$STACK_NAME' (detach=$DETACH)"
set -- --compose-file docker-compose.yml
for _extra in $COMPOSE_EXTRA; do
  if [ ! -f "$ROOT/$_extra" ] && [ ! -f "$_extra" ]; then
    log "ERROR: compose file not found: $_extra"
    exit 1
  fi
  if [ -f "$ROOT/$_extra" ]; then
    set -- "$@" --compose-file "$_extra"
  else
    set -- "$@" --compose-file "$_extra"
  fi
done
set -- "$@" "$STACK_NAME"
# Use --resolve-image never for locally-built images that are not in a registry
set -- "$@" --resolve-image never
if [ "$DETACH" = "true" ]; then
  docker stack deploy --detach "$@"
else
  docker stack deploy --detach=false "$@"
fi
log "Stack deploy finished"
exit 0
