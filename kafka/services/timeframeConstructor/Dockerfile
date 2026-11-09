# Use the official Node.js Alpine image
FROM node:26.13.0-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the application source code
COPY . .

# Expose default port
EXPOSE 3000

# Set default environment variables
ENV KAFKA_BROKERS=localhost:9092
ENV REDIS_URL=redis://redis:6379
ENV CONSUMER_GROUP_ID=timeframe_constructor_group
ENV INPUT_TOPICS=splited-live-data,backtest-stream-data
ENV BACKTEST_INPUT_TOPIC=backtest-stream-data
ENV OUTPUT_LIVE_TOPIC=timeframe_live_data
ENV OUTPUT_BACKTEST_TOPIC=timeframe_backtest_data
ENV KAFKA_NUM_PARTITIONS=50

# Command to run the microservice
CMD ["node", "timeframeConstructor.js"]
