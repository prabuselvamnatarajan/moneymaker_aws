#!/bin/sh

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
copy_shared() {
  target=$1
  cp -r ./appInit/redis_operations "$target/redis_operations"
  cp -r ./MicroServices/Shared/utils "$target/utils"
}

clean_shared() {
  target=$1
  rm -rf "$target/redis_operations"
  rm -rf "$target/utils"
}

copy_shared ./kafka/services/wsDataSplitterConsumer
docker build -t wsdatasplitterconsumer:latest ./kafka/services/wsDataSplitterConsumer
clean_shared ./kafka/services/wsDataSplitterConsumer

copy_shared ./kafka/services/storerConsumer
docker build -t storer-consumer:latest ./kafka/services/storerConsumer
clean_shared ./kafka/services/storerConsumer

copy_shared ./kafka/services/StrategyChooserConsumer
docker build -t strategy-chooser-consumer:latest ./kafka/services/StrategyChooserConsumer
clean_shared ./kafka/services/StrategyChooserConsumer

# BackTest Services
docker build -t backteststreamer:latest ./BackTest/BacktestStreamer
docker build -t backtestclient:latest ./BackTest/BacktestClient
docker build -t backtestapp:latest ./BackTest/BackTestApp
docker build -t backtestui:latest ./BackTest/BackTestUI
docker build -t exporttofile:latest ./ScheduledServices/ExportToFile

#Stream to Client Service
copy_shared ./kafka/services/streamToClient
docker build -t stream-to-client:latest ./kafka/services/streamToClient
clean_shared ./kafka/services/streamToClient

# Strategy Services
copy_shared ./kafka/services/Strategies/MSB
cp ./MicroServices/Shared/Accounts/account_utils.js ./kafka/services/Strategies/MSB/account_utils.js
docker build -t msb-strategy:latest ./kafka/services/Strategies/MSB
clean_shared ./kafka/services/Strategies/MSB
rm -f ./kafka/services/Strategies/MSB/account_utils.js

copy_shared ./kafka/services/Strategies/msb_pts
cp ./MicroServices/Shared/Accounts/account_utils.js ./kafka/services/Strategies/msb_pts/account_utils.js
docker build -t msb-pts-strategy:latest ./kafka/services/Strategies/msb_pts
clean_shared ./kafka/services/Strategies/msb_pts
rm -f ./kafka/services/Strategies/msb_pts/account_utils.js

copy_shared ./kafka/services/Strategies/liquidity_sweep
cp ./MicroServices/Shared/Accounts/account_utils.js ./kafka/services/Strategies/liquidity_sweep/account_utils.js
docker build -t liquidity-sweep-strategy:latest ./kafka/services/Strategies/liquidity_sweep
clean_shared ./kafka/services/Strategies/liquidity_sweep
rm -f ./kafka/services/Strategies/liquidity_sweep/account_utils.js

# Deploy the stack
if ! docker info | grep -q "Swarm: active"; then
  docker swarm init
fi
docker stack deploy --detach=false --compose-file docker-compose.yml moneymaker
