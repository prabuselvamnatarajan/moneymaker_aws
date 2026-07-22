#!/bin/sh
# Prepare Swarm state before stack deploy.
# Usage: . ./scripts/ensure_swarm_deploy_ready.sh

STACK_NAME=moneymaker
NETWORK_NAME=moneymaker_net
NETWORK_SUBNET=10.200.0.0/16

stack_exists() {
  docker stack ls --format '{{.Name}}' 2>/dev/null | grep -qx "$STACK_NAME"
}

network_exists() {
  docker network inspect "$NETWORK_NAME" >/dev/null 2>&1
}

wait_for_stack_removed() {
  count=0
  while stack_exists && [ "$count" -lt 60 ]; do
    echo "Waiting for stack $STACK_NAME to be removed..."
    sleep 2
    count=$((count + 1))
  done

  if stack_exists; then
    echo "ERROR: stack $STACK_NAME still exists after timeout." >&2
    exit 1
  fi
}

ensure_moneymaker_network() {
  if network_exists; then
    return 0
  fi

  echo "Creating overlay network $NETWORK_NAME..."
  docker network create \
    --driver overlay \
    --attachable \
    --subnet "$NETWORK_SUBNET" \
    "$NETWORK_NAME"
}

ensure_swarm_deploy_ready() {
  if ! docker info 2>/dev/null | grep -q "Swarm: active"; then
    echo "ERROR: Docker Swarm is not active." >&2
    exit 1
  fi

  if stack_exists && ! network_exists; then
    echo "Broken swarm state detected: stack exists but $NETWORK_NAME is missing."
    echo "Removing stack $STACK_NAME before redeploy..."
    docker stack rm "$STACK_NAME"
    wait_for_stack_removed
  fi

  ensure_moneymaker_network
}
