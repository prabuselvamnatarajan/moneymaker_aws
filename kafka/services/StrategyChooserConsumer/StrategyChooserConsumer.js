import { Kafka } from 'kafkajs';
import getStrategiesForSymbol from './redis_utils/getStrategiesForSymbol.js';
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
                const symbol = String(data.symbol || data.name || data.symbolName || rawKey).toUpperCase();
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
                    filteredStrategies = strategies.filter(strategy => {
                        if (String(strategy.deployment_id) !== String(data.deployment_id)) return false;
                        if (data.run_id && strategy.backtest_run_id && String(data.run_id) !== String(strategy.backtest_run_id)) {
                            logger.info(`Discarding stale backtest message for deployment ${data.deployment_id}. Msg run_id: ${data.run_id}, Active run_id: ${strategy.backtest_run_id}`);
                            return false;
                        }
                        return true;
                    });
                    logger.info(`Filtered strategies for symbol ${symbol} to deployment ${data.deployment_id}. Count: ${filteredStrategies.length}`);
                }

                await Promise.all(filteredStrategies.map(async (strategy) => {
                    const { name: strategyName, isTest = true } = strategy;
                    const isTestMode = isTest || isBackTest;
                    const topicName = isTestMode
                        ? `${strategyName}_backtest_data`
                        : `${strategyName}_live_data`;
                    
                    // Clone data to avoid concurrent in-place mutation race conditions
                    const strategyData = { ...data };
                    strategyData.strategy_details = { ...strategy };
                    if (isTestMode) {
                        strategyData.strategy_details.isTest = true;
                    } else {
                        strategyData.strategy_details.isTest = false;
                    }
                    await producer.send({
                        topic: topicName,
                        messages: [
                            { key: symbol, value: JSON.stringify(strategyData) },
                        ],
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

(async () => {
    await initLogger();
    await createConsumer();
})().catch((err) => {
    handleFatalError(err, 'consumer startup');
});