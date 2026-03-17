import { Kafka } from 'kafkajs';
import { MSB } from './MSB.js';
import { getLatestOHLCByInterval, getLTP } from './utils.js';
import { calculateLatency } from './utils/latencyUtil.js';
import { getMSBStrategyStateForSymbol, writeMSBStrategyStateForSymbol } from './redis_utils/getStrategyStateDetails.js';
import { initLogger, logger } from '../../../../MicroServices/Shared/utils/logUtils.js';

// Use environment variables with fallback defaults
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const BACKTEST_TOPIC_SUFFIX = process.env.BACKTEST_TOPIC_SUFFIX || '_backtest_data';
const LIVE_TOPIC_SUFFIX = process.env.LIVE_TOPIC_SUFFIX || '_live_data';
const STRATEGY_NAME = process.env.STRATEGY_NAME || 'msb';
const TARGET_TOPICS = [`${STRATEGY_NAME}${BACKTEST_TOPIC_SUFFIX}`, `${STRATEGY_NAME}${LIVE_TOPIC_SUFFIX}`];
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID;

const kafka = new Kafka({ clientId: 'stock-app', brokers: KAFKA_BROKERS });

async function createConsumer() {
    const consumer = kafka.consumer({ groupId: TARGET_GROUP_ID, sessionTimeout: 30000 });

    await consumer.connect();

    // Subscribe to all topics in TARGET_TOPICS
    for (const topic of TARGET_TOPICS) {
        logger.info(`Subscribing to topic: ${topic}`);
        await consumer.subscribe({ topic, fromBeginning: false });
    }

    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            const symbol = message.key.toString();
            const msg = JSON.parse(message.value.toString());
            msg.latency = {
                ...msg.latency,
                beforeStrategyExecution: calculateLatency(msg)
            };
            let { strategy_details = {}, done = false } = msg;

            if (done) {
                logger.info(`Received done signal for symbol ${symbol}, skipping processing.`);
                return;
            }

            const isBackTest = topic.includes(BACKTEST_TOPIC_SUFFIX) || strategy_details.isTest === true;
            if (isBackTest) {
                strategy_details.isTest = true;
            }
            logger.info(`Received message for symbol ${symbol}`);
            const lastState = await getMSBStrategyStateForSymbol(symbol, isBackTest);

            logger.debug(`Message content for ${symbol}:`, msg);
            
            let data = getLatestOHLCByInterval(msg, 'I1');
            let ltp = getLTP(msg);

            logger.debug(`Processing data for symbol ${symbol}:`, data);
            logger.debug(`Last Trade Price (LTP) for ${symbol}:`, ltp);
            data.ltp = ltp;

            // call the actual strategy function here
            let newState = await MSB(lastState, data, symbol, strategy_details);

            await writeMSBStrategyStateForSymbol(symbol, isBackTest, newState);
            
            //after strategy execution latency
            msg.latency.afterStrategyExecution = calculateLatency(msg);
            logger.debug('Latency:', msg.latency);
            
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