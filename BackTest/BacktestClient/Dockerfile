FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

ENV PORT=80
ENV WS_URL=ws://localhost:8085
ENV KAFKA_BROKERS=localhost:9092

CMD ["node", "clientServer.js"]
