# Use the official Node.js image
FROM node:18

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose the default port (if needed for debugging or monitoring)
EXPOSE 3000

# Copy .env file if needed (uncomment if you want to bake it in)
# COPY .env .env

ENV KAFKA_BROKERS=localhost:9092
ENV TARGET_TOPIC=splited-live-data,backtest-stream-data
ENV TARGET_GROUP_ID=MSB_Strategy_Processors
ENV SHARED_DIR=.

CMD ["node", "server.js"]
