import { Kafka } from 'kafkajs';
import retry from 'async-retry';
import RedisPubSub from "./redis_utils/redis_operations/RedisPubSub.js";
import { calculateLatency } from './utils/latencyUtil.js';
import { initLogger, logger } from './utils/logUtils.js';

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

function handleFatalError(error, context = 'service') {
    logger.error(`Fatal error in ${context}:`, error);
    process.exit(1);
}

process.on('uncaughtException', (error) => {
    handleFatalError(error, 'uncaught exception');
});

process.on('unhandledRejection', (reason) => {
    handleFatalError(reason, 'unhandled rejection');
});

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

async function processAndProduceMessages(data) {
    const producer = kafka.producer();

    try {
        await connectWithRetry(producer, 'Kafka Producer');

        for (const [key, value] of Object.entries(data)) {
            value.latency = {
                beforeSplit: calculateLatency(key, value)
            };
            const topic = "splited-live-data";
            value.symbol_name = key; // adding symbol_name to value
            logger.info(`Processing ${key} data:`, value);
            logger.info(`Topic : ${topic}`);

            let redisPublishChannel = `${LIVE_PREFIX}:${key.replace(/'/g, "")}`;

            await retry(async () => {
                let msg = JSON.stringify(value);
                await producer.send({
                    topic,
                    messages: [{ key, value: msg }],
                });
                logger.info(`redisPublishChannel : ${redisPublishChannel} with message: ${msg}`);
                await redisPubSub.publish(redisPublishChannel, msg);
            }, {
                retries: 5,
                minTimeout: 1000,
                onRetry: (error, attempt) => {
                    logger.warn(`Retry attempt ${attempt} for topic ${topic} due to error: ${error.message}`);
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

    try {
        await connectWithRetry(consumer, 'Kafka Consumer');
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
        await connectWithRetry(redisPubSub, 'Redis PubSub');
        await createConsumer();
    } catch (error) {
        handleFatalError(error, 'server startup');
    }
}

startServer();