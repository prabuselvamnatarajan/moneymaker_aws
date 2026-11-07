FROM node:26.13.0-alpine

# Set workdir
WORKDIR /app

# Copy files
COPY package*.json ./
RUN npm install

# Define environment variables
ENV GET_LTP_URL='https://reverse-proxy/ltp'
ENV EXPORT_CRON_SCHEDULE='15 16 * * *'

COPY . .

CMD ["node", "scheduler.js"]
