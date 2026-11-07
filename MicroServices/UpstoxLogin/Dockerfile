FROM node:26.13.0-alpine

# Set the working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy the application code
COPY . .

# Shared libs previously bind-mounted by docker-compose (required for k8s)
COPY ./redis_utils_bake/redis_operations /app/redis_utils/redis_operations

# Expose the port
EXPOSE 80

CMD ["node", "server.js"]
