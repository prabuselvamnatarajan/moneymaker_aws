# Use official Node.js LTS Alpine image
FROM node:26.13.0-alpine

# Built from the repo root so shared/redis_operations is in the image.
#   docker build -f ./appInit/Dockerfile -t appinit:latest .
WORKDIR /usr/src/app

COPY appInit/package*.json ./
RUN npm install

COPY appInit/ ./
COPY shared /usr/src/shared

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

CMD ["node", "start.js"]
