FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Set default environment variables (can be overridden at runtime)
ENV PORT=3000
ENV SHARED_DIR=/app/exportedData

EXPOSE 3000

CMD ["node", "streamer.js"]
