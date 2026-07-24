import { Kafka } from 'kafkajs';
import { LiquiditySweep } from './LiquiditySweep.js';
import { calculateLatency } from './utils/latencyUtil.js';
import {
    getLiquiditySweepStateForSymbol,
    writeLiquiditySweepStateForSymbol,
    setBacktestCompleted,
    assertFreshStateEpoch,
} from './redis_utils/getStrategyStateDetails.js';
import { initLogger, logger } from '/app/utils/logUtils.js';

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const TARGET_TOPIC = process.env.TARGET_TOPIC;
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID;
const IS_BACKTEST = process.env.IS_BACKTEST === 'true';

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

function resolveIsBackTest(strategy_details = {}) {
    if (IS_BACKTEST || strategy_details.strategy_mode === 'BACKTEST') {
        return true;
    }
    return strategy_details.isTest === true;
}

async function createConsumer() {
    const consumer = kafka.consumer({ groupId: TARGET_GROUP_ID, sessionTimeout: 30000 });

    await connectWithRetry(consumer, 'Kafka Consumer');
    logger.info(`Subscribing to topic: ${TARGET_TOPIC}`);
    await consumer.subscribe({ topic: TARGET_TOPIC, fromBeginning: false });

    await consumer.run({
        eachMessage: async ({ message }) => {
            const symbol = message.key?.toString();
            if (!symbol) {
                logger.warn('Received Kafka message without symbol key, skipping.');
                return;
            }

            let msg;
            try {
                msg = JSON.parse(message.value.toString());
            } catch (err) {
                logger.error(`Failed to parse Kafka message for ${symbol}: ${err.message}`);
                return;
            }

            const { strategy_details = {} } = msg;
            const isBackTestMsg = resolveIsBackTest(strategy_details);
            if (isBackTestMsg && msg.run_id && strategy_details.backtest_run_id && msg.run_id !== strategy_details.backtest_run_id) {
                logger.info(`Discarding stale backtest message in liquidity_sweep strategy. Msg run_id: ${msg.run_id}, Active: ${strategy_details.backtest_run_id}`);
                return;
            }

            try {
                if (msg.done) {
                    logger.info(`Received done signal for symbol ${symbol}, skipping processing.`);
                    if (strategy_details.deployment_id) {
                        await setBacktestCompleted(strategy_details.deployment_id);
                    }
                    return;
                }

                const beforeLatency = calculateLatency(symbol, msg);
                msg.latency = {
                    ...msg.latency,
                    ...(beforeLatency != null ? { beforeStrategyExecution: beforeLatency } : {}),
                };

                const isBackTest = resolveIsBackTest(strategy_details);
                if (isBackTest) {
                    strategy_details.isTest = true;
                }

                try {
                    await assertFreshStateEpoch(strategy_details);
                } catch (err) {
                    if (err?.name === 'StaleStateEpochError') {
                        logger.error(err.message);
                        return;
                    }
                    throw err;
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

                const afterLatency = calculateLatency(symbol, msg);
                if (afterLatency != null) {
                    msg.latency.afterStrategyExecution = afterLatency;
                }
                logger.debug('Latency:', msg.latency);
            } catch (err) {
                if (err?.name === 'StaleStateEpochError') {
                    logger.error(err.message);
                    return;
                }
                logger.error(`Fatal error processing message for ${symbol}:`, err);
                process.exit(1);
            }
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
