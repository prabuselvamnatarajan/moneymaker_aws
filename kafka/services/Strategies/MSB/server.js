import { Kafka } from 'kafkajs';
import { MSB } from './MSB.js';
import { getLatestOHLCByInterval, getLTP } from './utils.js';
import { calculateLatency } from './utils/latencyUtil.js';
import { getMSBStrategyStateForSymbol, writeMSBStrategyStateForSymbol } from './redis_utils/getStrategyStateDetails.js';
import { initLogger, logger } from '/app/utils/logUtils.js';

// Use environment variables with fallback defaults
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const TARGET_TOPIC = process.env.TARGET_TOPIC;
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID;
const IS_BACKTEST = process.env.IS_BACKTEST || false;

const kafka = new Kafka({ clientId: 'stock-app', brokers: KAFKA_BROKERS });

async function createConsumer() {
    const consumer = kafka.consumer({ groupId: TARGET_GROUP_ID, sessionTimeout: 30000 });

    await consumer.connect();
    logger.info(`Subscribing to topic: ${TARGET_TOPIC}`);
    await consumer.subscribe({ topic: TARGET_TOPIC, fromBeginning: false });

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

            const isBackTest = IS_BACKTEST || strategy_details.isTest === true;
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