# Use the official Node.js Alpine image
FROM node:26.13.0-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .
COPY ./redis_operations /app/redis_utils/redis_operations
COPY ./utils /app/utils

# Command to run the WebSocket server
CMD ["node", "wsServer.js"]
