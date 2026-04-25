# Use the official Node.js Alpine image as the base image
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install dependencies
RUN npm install

# Set environment variables
ENV KAFKA_BROKERS=kafka-broker-1:9092
ENV TARGET_TOPIC=order-details
ENV PORT=80
ENV NGINX_ADDRESS=http://nginx-server
ENV BACKTEST_APP_URL=/backtestapp
ENV BACKTEST_TRADE_URL=/api/trade

# Copy the rest of the application code to the working directory
COPY . .

# Expose the port the app runs on
EXPOSE 80

# Start the application
CMD ["node", "server.js"]
