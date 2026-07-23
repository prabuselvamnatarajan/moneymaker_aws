import { Kafka } from 'kafkajs';
import { MSB } from './MSB.js';
import { buildTimeframeCandle } from './candleBuilder.js';
import { getLTP, getTickTimestamp } from './utils.js';
import { calculateLatency } from './utils/latencyUtil.js';
import { getMSBStrategyStateForSymbol, writeMSBStrategyStateForSymbol, setBacktestCompleted } from './redis_utils/getStrategyStateDetails.js';
import { initLogger, logger } from '/app/utils/logUtils.js';
import { handleFatalError, registerFatalErrorHandlers, registerKafkaCrashHandler } from '/app/utils/kafkaErrorHandler.js';

// Use environment variables with fallback defaults
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const TARGET_TOPIC = process.env.TARGET_TOPIC;
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID;
const IS_BACKTEST = process.env.IS_BACKTEST || false;

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

async function createConsumer() {
    const consumer = kafka.consumer({ groupId: TARGET_GROUP_ID, sessionTimeout: 30000 });
    registerKafkaCrashHandler(consumer);

    await connectWithRetry(consumer, 'Kafka Consumer');
    logger.info(`Subscribing to topic: ${TARGET_TOPIC}`);
    await consumer.subscribe({ topic: TARGET_TOPIC, fromBeginning: false });

    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            try {
                const symbol = message.key.toString();
                const msg = JSON.parse(message.value.toString());
                console.log(`msg: ${JSON.stringify(msg)}`);
                let { strategy_details = {} } = msg;
                const isBackTest = IS_BACKTEST || strategy_details.isTest === true;
                if (isBackTest && msg.run_id && strategy_details.backtest_run_id && msg.run_id !== strategy_details.backtest_run_id) {
                    logger.info(`Discarding stale backtest message in MSB strategy. Msg run_id: ${msg.run_id}, Active: ${strategy_details.backtest_run_id}`);
                    return;
                }
                if (msg.done) {
                    logger.info(`Received done signal for symbol ${symbol}, skipping processing.`);
                    if (strategy_details.deployment_id) {
                        await setBacktestCompleted(strategy_details.deployment_id);
                    }
                    return;
                }

                msg.latency = {
                    ...msg.latency,
                    beforeStrategyExecution: calculateLatency(symbol, msg)
                };


                if (isBackTest) {
                    strategy_details.isTest = true;
                }
                const lastState = await getMSBStrategyStateForSymbol(symbol, isBackTest, strategy_details.deployment_id);

                logger.debug(`Message content for ${symbol}:`, msg);
                
                const timeframe = strategy_details.timeframe || '1m';
                const existingCandleState = lastState?.candleState || null;
                const { candle, newCandleState } = buildTimeframeCandle(msg, timeframe, existingCandleState);

                if (!candle || candle.high == null || candle.low == null || candle.ltp == null) {
                    logger.warn(`Skipping ${symbol}: tick missing valid OHLC or LTP (timeframe=${timeframe})`);
                    return;
                }

                logger.debug(`Processing ${timeframe} candle for symbol ${symbol}:`, candle);
                candle.candleState = newCandleState;

                // call the actual strategy function here
                let newState = await MSB(lastState, candle, symbol, strategy_details);

                await writeMSBStrategyStateForSymbol(symbol, isBackTest, newState, strategy_details.deployment_id);
                
                //after strategy execution latency
                msg.latency.afterStrategyExecution = calculateLatency(symbol, msg);
                logger.debug('Latency:', msg.latency);
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