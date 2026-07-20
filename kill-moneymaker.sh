#!/bin/sh

echo "Removing stack moneymaker..."
docker stack rm moneymaker 2>/dev/null

echo "Waiting for stack resources to be removed..."
count=0
while [ -n "$(docker stack ls | grep moneymaker)" ] && [ $count -lt 15 ]; do
  sleep 1
  count=$((count + 1))
done

echo "Cleaning up network moneymaker_app-net..."
count=0
while [ -n "$(docker network ls | grep moneymaker_app-net)" ] && [ $count -lt 10 ]; do
  docker network rm moneymaker_app-net 2>/dev/null
  sleep 1
  count=$((count + 1))
done

echo "Leaving swarm (forcing clean breakdown)..."
docker swarm leave --force 2>/dev/null

echo "Moneymaker stack removed successfully."
