# Use the official Node.js Alpine image
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .
COPY ./redis_operations /app/redis_utils/redis_operations
COPY ./account_utils.js /app/redis_utils/account_utils.js
COPY ./utils /app/utils

# Expose the default port (if needed for debugging or monitoring)
EXPOSE 3000

# Copy .env file if needed (uncomment if you want to bake it in)
# COPY .env .env

ENV KAFKA_BROKERS=localhost:9092
ENV BACKTEST_TOPIC_SUFFIX=_backtest_data
ENV LIVE_TOPIC_SUFFIX=_live_data
ENV STRATEGY_NAME=msb
ENV TARGET_GROUP_ID=MSB_Strategy_Processors
ENV SHARED_DIR=/shared
ENV PLACEORDER_API=http://localhost/placeorder

CMD ["node", "server.js"]
