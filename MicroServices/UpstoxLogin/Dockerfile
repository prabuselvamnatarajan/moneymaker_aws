FROM node:18

# Set the working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy the application code
COPY . .

# Expose the port
EXPOSE 80

# Pass environment variables at runtime
CMD ["sh", "-c", "CLIENT_ID=$CLIENT_ID CLIENT_SECRET=$CLIENT_SECRET REDIRECT_URI=$REDIRECT_URI node server.js"]
