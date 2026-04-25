# Use the official MongoDB image
FROM mongo:6.0

# Copy the initialization script to the container
COPY init-mongo.js /docker-entrypoint-initdb.d/

# Expose the default MongoDB port
EXPOSE 27017
