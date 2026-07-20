#!/bin/sh

ROOT="$(CDPATH= cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
. "$ROOT/scripts/copy_shared.sh"

docker build -t appinit:latest ./appInit

docker build -t upstock-login:latest ./MicroServices/UpstoxLogin
docker build -t connect-upstox-web-socket:latest ./MicroServices/ConnectWS-Upstox

# MicroServices
docker build -t get-ltp:latest ./MicroServices/market-quote/getLTP
docker build -t get-ohlc:latest ./MicroServices/market-quote/getOHLC
docker build -t get-fullmarketquote:latest ./MicroServices/market-quote/fullMarketQuote
docker build -t placeorder:latest ./MicroServices/Orders/placeOrders
docker build -t get-orderbook:latest ./MicroServices/Orders/getOrderBook
docker build -t get-put-call-option-chain:latest ./MicroServices/Option-Chain/put-call-option-chain
docker build -t get-option-contracts:latest ./MicroServices/Option-Chain/option-contracts
docker build -t get-funds-and-margin:latest ./MicroServices/Users/FundsAndMargin

# Kafka Services (with shared context copying)
build_kafka_service ./kafka/services/wsDataSplitterConsumer wsdatasplitterconsumer:latest
build_kafka_service ./kafka/services/storerConsumer storer-consumer:latest
build_kafka_service ./kafka/services/StrategyChooserConsumer strategy-chooser-consumer:latest
build_kafka_service ./kafka/services/positionTrackerConsumer position-tracker-consumer:latest
build_kafka_service ./kafka/services/deploymentSymbolResolverConsumer deployment-symbol-resolver-consumer:latest

# BackTest Services
docker build -t backteststreamer:latest ./BackTest/BacktestStreamer
docker build -t backtestclient:latest ./BackTest/BacktestClient
docker build -t backtestapp:latest ./BackTest/BackTestApp
docker build -t backtestui:latest ./BackTest/BackTestUI
docker build -t exporttofile:latest ./ScheduledServices/ExportToFile

# Stream to Client Service
build_kafka_service ./kafka/services/streamToClient stream-to-client:latest

# Strategy Services
build_strategy ./kafka/services/Strategies/MSB msb-strategy:latest
build_strategy ./kafka/services/Strategies/msb_pts msb-pts-strategy:latest
build_strategy ./kafka/services/Strategies/liquidity_sweep liquidity-sweep-strategy:latest

# Deploy the stack
if ! docker info | grep -q "Swarm: active"; then
  echo "Initializing Docker Swarm..."
  docker swarm init
  echo "Waiting for Swarm network control plane..."
  sleep 3
fi

echo "Deploying MoneyMaker stack..."
docker stack deploy --detach=false --compose-file docker-compose.yml moneymaker
