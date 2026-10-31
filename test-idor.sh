#!/bin/bash
set -x

docker logs $(docker ps -qf "name=backtest-app") | tail -n 50
