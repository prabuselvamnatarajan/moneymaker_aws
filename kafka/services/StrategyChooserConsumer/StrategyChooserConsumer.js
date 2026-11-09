import { Kafka } from 'kafkajs';
import retry from 'async-retry';
import getStrategiesForSymbol from './redis_utils/getStrategiesForSymbol.js';
import {
  resolveTopicName,
  extractSymbol,
  buildMessagePayload,
  resolvePartitionKey,
  filterBacktestStrategies,
} from './topicRoutingHelper.js';
import { initLogger, logger } from '/app/utils/logUtils.js';
import { handleFatalError, registerFatalErrorHandlers, registerKafkaCrashHandler } from '/app/utils/kafkaErrorHandler.js';

// Use environment variables with fallback defaults
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const TARGET_TOPICS = (process.env.TARGET_TOPIC || '').split(',').map(t => t.trim()).filter(Boolean);
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID;
const BACKTEST_TOPIC = process.env.BACKTEST_TOPIC || 'backtest-stream-data';
const KAFKA_NUM_PARTITIONS = parseInt(process.env.KAFKA_NUM_PARTITIONS || '50', 10);

const kafka = new Kafka({
  clientId: 'stock-app',
  brokers: KAFKA_BROKERS,
  retry: {
    initialRetryTime: 300,
    retries: 20
  }
});

registerFatalErrorHandlers();

async function connectWithRetry(target, name = 'Client', retries = 30, delay = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            await target.connect();
            logger.info(`Successfully connected to ${name}.`);
            return;
        } catch (err) {
            logger.warn(`Connection attempt ${i + 1}/${retries} to ${name} failed: ${err.message}. Retrying in ${delay}ms...`);
            await new Promise(res => setTimeout(res, delay));
        }
    }
    throw new Error(`Failed to connect to ${name} after maximum retries.`);
}

async function ensureTopicPartitions(topics, numPartitions = 50) {
  const admin = kafka.admin();
  try {
    await admin.connect();
    const existingTopics = await admin.listTopics();
    const existingInSet = new Set(existingTopics);
    const topicsToCreate = [];

    for (const t of topics) {
      if (!existingInSet.has(t)) {
        topicsToCreate.push({ topic: t, numPartitions, replicationFactor: 3 });
      }
    }

    if (topicsToCreate.length > 0) {
      await admin.createTopics({ topics: topicsToCreate, waitForLeaders: true });
      logger.info(`Created missing topics with ${numPartitions} partitions: ${topicsToCreate.map(t => t.topic).join(', ')}`);
    }

    const topicsToFetch = topics.filter(t => existingInSet.has(t));
    if (topicsToFetch.length > 0) {
      const metadata = await admin.fetchTopicMetadata({ topics: topicsToFetch });
      const topicsToIncrease = [];

      for (const topicMeta of metadata.topics) {
        if (topicMeta && topicMeta.partitions && topicMeta.partitions.length < numPartitions) {
          topicsToIncrease.push({ topic: topicMeta.name, count: numPartitions });
        }
      }

      if (topicsToIncrease.length > 0) {
        await admin.createPartitions({ topicPartitions: topicsToIncrease });
        logger.info(`Increased partitions to ${numPartitions} for: ${topicsToIncrease.map(t => t.topic).join(', ')}`);
      }
    }
  } catch (err) {
    logger.warn(`Failed to auto-ensure topic partitions: ${err.message}`);
  } finally {
    await admin.disconnect().catch(() => {});
  }
}

async function createConsumer() {
    const consumer = kafka.consumer({ groupId: TARGET_GROUP_ID, sessionTimeout: 30000 });
    const producer = kafka.producer();

    // Listen to crash event to ensure the process exits if Kafka consumer crashes
    registerKafkaCrashHandler(consumer);

    await connectWithRetry(consumer, 'Kafka Consumer');
    await connectWithRetry(producer, 'Kafka Producer');

    // Ensure topics have enough partitions for parallel consumer load balancing
    await ensureTopicPartitions(TARGET_TOPICS, KAFKA_NUM_PARTITIONS);

    // Subscribe to all topics in TARGET_TOPICS
    for (const topic of TARGET_TOPICS) {
        await consumer.subscribe({ topic, fromBeginning: false });
    }

    await consumer.run({
        eachMessage: async ({ topic, message: { key, value } }) => {
            try {
                const rawKey = key ? key.toString() : '';
                const data = JSON.parse(value.toString());
                const symbol = extractSymbol(data, rawKey);
                const isBackTest = topic === BACKTEST_TOPIC;
                logger.info(`Received message for symbol ${symbol} on topic ${topic} (isBackTest: ${isBackTest})`);
                const strategies = await getStrategiesForSymbol(isBackTest, symbol);
                logger.debug(`Active strategies for ${symbol}: ${JSON.stringify(strategies)}`);

                let filteredStrategies = strategies;
                if (isBackTest) {
                    if (!data.deployment_id) {
                        logger.warn(`Discarding backtest message for symbol ${symbol}: missing deployment_id`);
                        return;
                    }
                    filteredStrategies = filterBacktestStrategies(strategies, data);
                    logger.info(`Filtered strategies for symbol ${symbol} to deployment ${data.deployment_id}. Count: ${filteredStrategies.length}`);
                }

                await Promise.all(filteredStrategies.map(async (strategy) => {
                    const { name: strategyName, isTest = true } = strategy;
                    const isTestMode = isTest || isBackTest;
                    const topicName = resolveTopicName(strategyName, isTestMode);
                    const strategyData = buildMessagePayload(data, strategy, isTestMode);
                    const partitionKey = resolvePartitionKey(symbol, strategy, isTestMode);
                    await retry(async () => {
                        await producer.send({
                            topic: topicName,
                            messages: [
                                { key: partitionKey, value: JSON.stringify(strategyData) },
                            ],
                        });
                    }, {
                        retries: 5,
                        minTimeout: 1000,
                        onRetry: (error, attempt) => {
                            logger.warn(`Kafka produce retry ${attempt} for topic ${topicName} due to error: ${error.message}`);
                        }
                    });
                    logger.debug(`Produced message to topic ${topicName} with key ${symbol}`);
                    logger.debug(`sending msg: ${JSON.stringify(strategyData)}`);
                }));
            } catch (error) {
                handleFatalError(error, 'message handling');
            }
        },
    });
}

async function startServer() {
    await initLogger();
    await createConsumer();
}
if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'test_env') {
    startServer().catch((err) => {
        handleFatalError(err, 'consumer startup');
    });
}
export { startServer };