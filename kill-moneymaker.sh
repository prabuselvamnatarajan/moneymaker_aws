#!/bin/sh

echo "Removing stack moneymaker..."
docker stack rm moneymaker 2>/dev/null

echo "Waiting for stack services and networks to shut down..."
count=0
while [ -n "$(docker stack ls | grep moneymaker)" ] && [ $count -lt 30 ]; do
  sleep 1
  count=$((count + 1))
done

echo "Moneymaker stack removed successfully."
