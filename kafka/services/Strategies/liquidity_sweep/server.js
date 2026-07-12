import { Kafka } from 'kafkajs';
import { LiquiditySweep } from './LiquiditySweep.js';
import { calculateLatency } from './utils/latencyUtil.js';
import {
    getLiquiditySweepStateForSymbol,
    writeLiquiditySweepStateForSymbol,
    setBacktestCompleted,
} from './redis_utils/getStrategyStateDetails.js';
import { initLogger, logger } from '/app/utils/logUtils.js';

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const TARGET_TOPIC = process.env.TARGET_TOPIC;
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID;
const IS_BACKTEST = process.env.IS_BACKTEST || false;

const kafka = new Kafka({
    clientId: 'liquidity-sweep-app',
    brokers: KAFKA_BROKERS,
    retry: {
        initialRetryTime: 300,
        retries: 20,
    },
});

async function connectWithRetry(target, name = 'Client', retries = 30, delay = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            await target.connect();
            logger.info(`Successfully connected to ${name}.`);
            return;
        } catch (err) {
            logger.warn(`Connection attempt ${i + 1}/${retries} to ${name} failed: ${err.message}. Retrying in ${delay}ms...`);
            await new Promise((res) => setTimeout(res, delay));
        }
    }
    throw new Error(`Failed to connect to ${name} after maximum retries.`);
}

async function createConsumer() {
    const consumer = kafka.consumer({ groupId: TARGET_GROUP_ID, sessionTimeout: 30000 });

    await connectWithRetry(consumer, 'Kafka Consumer');
    logger.info(`Subscribing to topic: ${TARGET_TOPIC}`);
    await consumer.subscribe({ topic: TARGET_TOPIC, fromBeginning: false });

    await consumer.run({
        eachMessage: async ({ message }) => {
            const symbol = message.key.toString();
            const msg = JSON.parse(message.value.toString());
            const { strategy_details = {} } = msg;

            if (msg.done) {
                logger.info(`Received done signal for symbol ${symbol}, skipping processing.`);
                if (strategy_details.deployment_id) {
                    await setBacktestCompleted(strategy_details.deployment_id);
                }
                return;
            }

            msg.latency = {
                ...msg.latency,
                beforeStrategyExecution: calculateLatency(symbol, msg),
            };

            const isBackTest = IS_BACKTEST || strategy_details.isTest === true;
            if (isBackTest) {
                strategy_details.isTest = true;
            }

            const lastState = await getLiquiditySweepStateForSymbol(
                symbol,
                isBackTest,
                strategy_details.deployment_id
            );

            const newState = await LiquiditySweep(lastState, msg, symbol, strategy_details);

            await writeLiquiditySweepStateForSymbol(
                symbol,
                isBackTest,
                newState,
                strategy_details.deployment_id
            );

            msg.latency.afterStrategyExecution = calculateLatency(symbol, msg);
            logger.debug('Latency:', msg.latency);
        },
    });
}

(async () => {
    await initLogger();
    await createConsumer();
})().catch((err) => {
    if (logger?.error) {
        logger.error('Unhandled error in liquidity_sweep consumer', err);
    } else {
        console.error('Unhandled error in liquidity_sweep consumer', err);
    }
    process.exit(1);
});
