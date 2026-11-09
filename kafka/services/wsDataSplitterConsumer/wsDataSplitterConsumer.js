import { Kafka } from 'kafkajs';
import retry from 'async-retry';
import RedisPubSub from "./redis_utils/redis_operations/RedisPubSub.js";
import { getCalculateLatency, splitAndTransformBatch, connectWithRetry } from './batchSplitter.js';
import { initLogger, logger } from '/app/utils/logUtils.js';
import { handleFatalError, registerFatalErrorHandlers, registerKafkaCrashHandler } from '/app/utils/kafkaErrorHandler.js';

// Use environment variables with fallback defaults
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const LIVE_PREFIX = process.env.LIVE_PREFIX || "live";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const kafka = new Kafka({
  clientId: 'stock-app',
  brokers: KAFKA_BROKERS,
  retry: {
    initialRetryTime: 300,
    retries: 20
  }
});

const redisPubSub = new RedisPubSub({ url: REDIS_URL });

registerFatalErrorHandlers();

async function processAndProduceMessages(data) {
    const producer = kafka.producer();

    try {
        await connectWithRetry(producer, 'Kafka Producer', 30, 5000, logger);
        const calculateLatency = await getCalculateLatency();
        const { kafkaMessages, redisPublishes } = splitAndTransformBatch(data, LIVE_PREFIX, calculateLatency);

        for (let i = 0; i < kafkaMessages.length; i++) {
            const km = kafkaMessages[i];
            const rp = redisPublishes[i];

            logger.info(`Processing ${km.key} data:`, km.parsed);
            logger.info(`Topic : ${km.topic}`);

            await retry(async () => {
                await producer.send({
                    topic: km.topic,
                    messages: [{ key: km.key, value: km.value }],
                });
                logger.info(`redisPublishChannel : ${rp.channel} with message: ${rp.message}`);
                await redisPubSub.publish(rp.channel, rp.message);
            }, {
                retries: 5,
                minTimeout: 1000,
                onRetry: (error, attempt) => {
                    logger.warn(`Retry attempt ${attempt} for topic ${km.topic} due to error: ${error.message}`);
                }
            });
        }
    } catch (error) {
        handleFatalError(error, 'message processing');
    } finally {
        await producer.disconnect().catch(() => {});
    }
}

async function createConsumer() {   
    const consumer = kafka.consumer({ groupId: 'WS_data_splitter', sessionTimeout: 30000 });
    registerKafkaCrashHandler(consumer);

    try {
        await connectWithRetry(consumer, 'Kafka Consumer', 30, 5000, logger);
        await consumer.subscribe({ topic: 'incoming-ws-msg', fromBeginning: false });

        await consumer.run({
            eachMessage: async ({ message }) => {
                try {
                    const data = JSON.parse(message.value.toString());
                    await processAndProduceMessages(data);
                } catch (error) {
                    handleFatalError(error, 'message handling');
                }
            },
        });
    } catch (error) {
        handleFatalError(error, 'consumer setup');
    }
}

async function startServer() {
    try {
        await initLogger();
        await connectWithRetry(redisPubSub, 'Redis PubSub', 30, 5000, logger);
        await createConsumer();
    } catch (error) {
        handleFatalError(error, 'server startup');
    }
}

if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'test_env') {
    startServer();
}

export { processAndProduceMessages, createConsumer, startServer };
