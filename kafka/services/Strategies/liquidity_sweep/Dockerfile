FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
COPY ./redis_operations /app/redis_utils/redis_operations
COPY ./account_utils.js /app/redis_utils/account_utils.js
COPY ./utils /app/utils
COPY ./strategy /app/strategy

EXPOSE 3000

ENV KAFKA_BROKERS=localhost:9092
ENV BACKTEST_TOPIC_SUFFIX=_backtest_data
ENV LIVE_TOPIC_SUFFIX=_live_data
ENV STRATEGY_NAME=liquidity_sweep
ENV TARGET_GROUP_ID=liquidity_sweep_strategy_group
ENV SHARED_DIR=/shared
ENV PLACEORDER_API=http://localhost/placeorder

CMD ["node", "LiquiditySweep.js"]
