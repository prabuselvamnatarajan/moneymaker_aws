# Use the official Confluent Zookeeper image
FROM confluentinc/cp-zookeeper:latest

# Set environment variables for Zookeeper
ENV ZOOKEEPER_CLIENT_PORT=2181
ENV ZOOKEEPER_TICK_TIME=2000

# Expose Zookeeper port
EXPOSE 2181

# Start Zookeeper
CMD ["bash", "-c", "/etc/confluent/docker/run"]