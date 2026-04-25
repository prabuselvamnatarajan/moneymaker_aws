# Use official Node.js LTS Alpine image
FROM node:18-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json if present
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the app source code
COPY . .

# Set environment variables (example values, update as needed)
ENV MONGO_URI=mongodb://mongo:27017
ENV APP_INIT_DB=appInit
ENV DB_LIVE_STRATEGYCHOOSER=strategyChooser
ENV REDIS_LIVE_STRATEGYCHOOSER='{"key":"strategyChooserKey","data_type":"json"}'
ENV REDIS_URL=redis://redis:6379
ENV PROPERTY_LIVE_STRATEGYCHOOSER=propertyName

ENV DB_LIVE_WEBSOCKETLISTENING=webSocketListening
ENV REDIS_LIVE_WEBSOCKETLISTENING='{"key":"webSocketListeningKey","data_type":"json"}'
ENV PROPERTY_LIVE_WEBSOCKETLISTENING=propertyName

# Set the default command to run start.js
CMD ["node", "start.js"]
