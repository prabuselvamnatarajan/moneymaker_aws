# Use the official Node.js Alpine image
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
COPY ./redis_operations /app/redis_utils/redis_operations
COPY ./utils /app/utils

EXPOSE 3000

ENV KAFKA_BROKERS=localhost:9092
ENV MONGO_URI=mongodb://localhost:27017
ENV MONGO_DB=BacktestApp
ENV TARGET_TOPIC=splited-live-data,backtest-stream-data
ENV TARGET_GROUP_ID=position_tracker_group

CMD ["node", "positionTrackerConsumer.js"]
