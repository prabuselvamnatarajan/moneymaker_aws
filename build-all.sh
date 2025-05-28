#!/bin/sh

docker build -t upstock-login:latest ./MicroServices/UpstoxLogin
docker build -t connect-upstox-web-socket:latest ./MicroServices/ConnectWS-Upstox
docker build -t get-ltp:latest ./MicroServices/market-quote/getLTP
docker build -t get-ohlc:latest ./MicroServices/market-quote/getOHLC
docker build -t get-fullmarketquote:latest ./MicroServices/market-quote/fullMarketQuote
docker build -t placeorder:latest ./MicroServices/Orders/placeOrders
docker build -t get-orderbook:latest ./MicroServices/Orders/getOrderBook

docker stack deploy --detach=false --compose-file docker-compose.yml moneymaker
