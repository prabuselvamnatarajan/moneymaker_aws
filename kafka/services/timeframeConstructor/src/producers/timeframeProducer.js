import retry from 'async-retry';

/**
 * Resolve the partition key for a snapshot.
 * Uses symbol:deployment_id if deployment_id is present (backtest isolation),
 * otherwise defaults to symbol (live stream).
 *
 * @param {Object} snapshot - Combined timeframe snapshot payload
 * @returns {string} Partition key
 */
export function resolvePartitionKey(snapshot) {
  if (snapshot?.deployment_id) {
    return `${snapshot.symbol}:${snapshot.deployment_id}`;
  }
  return snapshot?.symbol || '';
}

/**
 * Publishes combined multi-timeframe snapshots to Kafka.
 */
export class TimeframeProducer {
  /**
   * @param {Object} kafkaProducer - kafkajs Producer
   * @param {Object} [logger=console]
   */
  constructor(kafkaProducer, logger = console) {
    this.producer = kafkaProducer;
    this.logger = logger;
  }

  /**
   * Publish a snapshot to the appropriate Kafka topic with the resolved partition key.
   *
   * @param {string} topic - e.g. 'timeframe_live_data' or 'timeframe_backtest_data'
   * @param {Object} snapshot - Combined timeframe snapshot payload
   */
  async publishSnapshot(topic, snapshot) {
    const key = resolvePartitionKey(snapshot);
    const value = JSON.stringify(snapshot);

    await retry(
      async () => {
        await this.producer.send({
          topic,
          messages: [{ key, value }],
        });
      },
      {
        retries: 5,
        minTimeout: 500,
        onRetry: (err, attempt) => {
          this.logger.warn?.(
            `Kafka produce retry ${attempt} for topic ${topic} (key=${key}): ${err.message}`
          );
        },
      }
    );
  }
}
