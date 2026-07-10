#!/bin/sh

echo "Removing stack moneymaker..."
docker stack rm moneymaker

echo "Waiting for stack resources to be removed..."
while [ -n "$(docker stack ls | grep moneymaker)" ]; do
  sleep 1
done

echo "Waiting for network moneymaker_app-net to be removed..."
while [ -n "$(docker network ls | grep moneymaker_app-net)" ]; do
  sleep 1
done

echo "Leaving swarm..."
docker swarm leave --force
