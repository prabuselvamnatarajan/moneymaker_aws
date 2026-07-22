#!/bin/sh

ROOT="$(CDPATH= cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

STACK_NAME=moneymaker
SERVICE_NAME="${STACK_NAME}_backtest-app"
SEED_SCRIPT="src/db/clear_and_seed.js"
SKIP_CONFIRM=false

usage() {
  cat <<EOF
Usage: $(basename "$0") [--yes]

Wipe and reseed the BacktestApp MongoDB database in the running production stack.

This runs BackTest/BackTestApp/src/db/clear_and_seed.js inside the
${SERVICE_NAME} container using the service's existing environment variables.

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

if ! docker info 2>/dev/null | grep -q "Swarm: active"; then
  echo "ERROR: Docker Swarm is not active." >&2
  exit 1
fi

container_id="$(docker ps \
  --filter "label=com.docker.swarm.service.name=${SERVICE_NAME}" \
  --filter "status=running" \
  -q | head -n 1)"

if [ -z "$container_id" ]; then
  echo "ERROR: No running container found for ${SERVICE_NAME}." >&2
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

echo "Running clear_and_seed.js in ${SERVICE_NAME} (container ${container_id})..."
docker exec "$container_id" node "$SEED_SCRIPT"
