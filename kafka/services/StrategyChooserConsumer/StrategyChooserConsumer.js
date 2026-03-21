import { Kafka } from 'kafkajs';
import getStrategiesForSymbol from './redis_utils/getStrategiesForSymbol.js';
import { initLogger, logger } from '/app/utils/logUtils.js';

// Use environment variables with fallback defaults
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const TARGET_TOPICS = (process.env.TARGET_TOPIC || '').split(',').map(t => t.trim()).filter(Boolean);
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID;
const BACKTEST_TOPIC = process.env.BACKTEST_TOPIC || 'backtest-stream-data';

const kafka = new Kafka({ clientId: 'stock-app', brokers: KAFKA_BROKERS });

async function createConsumer() {
    const consumer = kafka.consumer({ groupId: TARGET_GROUP_ID, sessionTimeout: 30000 });
    const producer = kafka.producer();

    await consumer.connect();
    await producer.connect();

    // Subscribe to all topics in TARGET_TOPICS
    for (const topic of TARGET_TOPICS) {
        await consumer.subscribe({ topic, fromBeginning: false });
    }

    await consumer.run({
        eachMessage: async ({ topic, message: { key, value } }) => {
            const symbol = key.toString();
            const isBackTest = topic === BACKTEST_TOPIC;
            logger.info(`Received message for symbol ${symbol} on topic ${topic} (isBackTest: ${isBackTest})`);
            const strategies = await getStrategiesForSymbol(isBackTest, symbol);
            logger.debug(`Active strategies for ${symbol}:`, strategies);
            const data = JSON.parse(value.toString());

            await Promise.all(strategies.map(async (strategy) => {
                try {
                    let { name: strategyName, isTest = true } = strategy;
                    const isTestMode = isTest || isBackTest;
                    const topicName = isTestMode
                        ? `${strategyName}_backtest_data`
                        : `${strategyName}_live_data`;
                    data.strategy_details = strategy;
                    if (isTestMode) {
                        data.strategy_details.isTest = true;
                    } else {
                        data.strategy_details.isTest = false;
                    }
                    await producer.send({
                        topic: topicName,
                        messages: [
                            { key: symbol, value: JSON.stringify(data) },
                        ],
                    });
                    logger.debug(`Produced message to topic ${topicName} with key ${symbol}`);
                } catch (error) {
                    logger.error(`Failed to produce message to topic ${strategyName}_live_data for symbol ${symbol}:`, error.message);
                }
            }));
        },
    });
}

(async () => {
    await initLogger();
    await createConsumer();
})().catch((err) => {
    if (logger && logger.error) {
        logger.error('Unhandled error in consumer', err);
    } else {
        // Fallback if logger isn't available
        console.error('Unhandled error in consumer', err);
    }
    process.exit(1);
});