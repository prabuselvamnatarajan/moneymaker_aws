#!/bin/sh

docker stack rm moneymaker
docker swarm leave --force
