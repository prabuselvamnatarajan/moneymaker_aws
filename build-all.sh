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

# Kafka Services
docker build -t wsdatasplitterconsumer:latest ./kafka/services/wsDataSplitterConsumer
docker build -t storer-consumer:latest ./kafka/services/storerConsumer
docker build -t strategy-chooser-consumer:latest ./kafka/services/StrategyChooserConsumer

# BackTest Services
docker build -t backteststreamer:latest ./BackTest/BacktestStreamer
docker build -t backtestclient:latest ./BackTest/BacktestClient
docker build -t backtestapp:latest ./BackTest/BackTestApp
docker build -t exporttofile:latest ./ScheduledServices/ExportToFile

# Strategy Services
docker build -t msb-strategy:latest ./kafka/services/Strategies/MSB

# Deploy the stack
docker stack deploy --detach=false --compose-file docker-compose.yml moneymaker
