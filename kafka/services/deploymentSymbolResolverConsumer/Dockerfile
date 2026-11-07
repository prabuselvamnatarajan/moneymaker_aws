# Use the official Node.js Alpine image
FROM node:26.13.0-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
COPY ./redis_operations /app/redis_utils/redis_operations
COPY ./utils /app/utils

ENV KAFKA_BROKERS=localhost:9092
ENV TARGET_TOPIC=splited-live-data,backtest-stream-data
ENV TARGET_GROUP_ID=deployment_symbol_resolver_group
ENV BACKTEST_APP_URL=http://backtest-app:80
# BACKTEST_SERVICE_TOKEN must be provided at deploy time (see docker-compose)

CMD ["node", "deploymentSymbolResolverConsumer.js"]
