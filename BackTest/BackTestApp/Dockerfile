FROM node:18-alpine

RUN apk add --no-cache docker-cli

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

ENV PORT=3000
ENV MONGO_URI=mongodb://root:example@mongo1:27017,mongo2:27018,mongo3:27019/?replicaSet=rs0&authSource=admin
ENV MONGO_DB=BacktestApp

CMD ["node", "src/server.js"]
