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

# Set default environment variables (can be overridden at runtime)
ENV KAFKA_BROKERS=localhost:9092
ENV MONGO_URI=mongodb://localhost:27017

# Command to run the Kafka consumer
CMD ["node", "storerConsumer.js"]