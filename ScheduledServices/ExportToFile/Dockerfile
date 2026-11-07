FROM node:26.13.0-alpine

# Set workdir
WORKDIR /app

# Copy files
COPY package*.json ./
RUN npm install

# Define environment variables
ENV MONGO_URI=mongodb://root:example@13.127.182.75:27017/?authSource=admin
ENV DB_NAME=stock_database
ENV EXPORT_PREF_COLLECTION=exportPreferences
ENV EXPORT_CRON_SCHEDULE='15 16 * * *'

COPY . .

CMD ["node", "scheduler.js"]
