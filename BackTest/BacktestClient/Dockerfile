FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

ENV CLIENT_PORT=3000
ENV WS_URL=ws://localhost:8085
ENV KAFKA_BROKERS=localhost:9092
ENV KAFKA_TOPIC=backtest-stream-data

CMD ["node", "clientServer.js"]
