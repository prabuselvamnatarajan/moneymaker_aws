#!/bin/sh

echo "Removing stack moneymaker..."
docker stack rm moneymaker 2>/dev/null

echo "Waiting for stack services and networks to shut down..."
count=0
while [ -n "$(docker stack ls | grep moneymaker)" ] && [ $count -lt 30 ]; do
  sleep 1
  count=$((count + 1))
done

# Best-effort cleanup of dangling overlay network left by swarm stack rm.
if docker network inspect moneymaker_net >/dev/null 2>&1; then
  echo "Removing dangling moneymaker_net overlay network..."
  docker network rm moneymaker_net 2>/dev/null || true
  # Retry briefly if containers are still detaching
  n=0
  while docker network inspect moneymaker_net >/dev/null 2>&1 && [ $n -lt 10 ]; do
    sleep 1
    docker network rm moneymaker_net 2>/dev/null || true
    n=$((n + 1))
  done
fi

echo "Moneymaker stack removed successfully."
