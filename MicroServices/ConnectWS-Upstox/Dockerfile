# Use the official Node.js Alpine image as the base image
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code to the working directory
COPY . .

# Shared libs previously bind-mounted by docker-compose (required for k8s)
COPY ./redis_utils_bake/redis_operations /app/redis_utils/redis_operations
COPY ./redis_utils_bake/AuthoriseUpstoxClient.js /app/redis_utils/AuthoriseUpstoxClient.js

# Set environment variables
ENV KAFKA_BROKERS=localhost:9092
ENV PORT=80

# Expose the port the app runs on
EXPOSE 80

# Start the application
CMD ["node", "server.js"]
