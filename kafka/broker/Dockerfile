# Use the official Confluent Kafka image
FROM confluentinc/cp-kafka:latest

# Set environment variables for Kafka
ENV KAFKA_ZOOKEEPER_CONNECT=zookeeper:2181
ENV KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://broker:9092
ENV KAFKA_LISTENERS=PLAINTEXT://0.0.0.0:9092
ENV KAFKA_BROKER_ID=1
ENV KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1
ENV KAFKA_LOG_DIRS=/var/lib/kafka/data

# Expose Kafka port
EXPOSE 9092

# Start Kafka broker
CMD ["bash", "-c", "/etc/confluent/docker/run"]
