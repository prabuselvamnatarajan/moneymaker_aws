const { Kafka } = require('kafkajs');
const MSB = require('./MSB');
const { getLatestOHLCByInterval, getLTP } = require('./utils');
const fs = require('fs').promises;

// Use environment variables with fallback defaults
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const BACKTEST_TOPIC_SUFFIX = process.env.BACKTEST_TOPIC_SUFFIX || '_backtest_data';
const LIVE_TOPIC_SUFFIX = process.env.LIVE_TOPIC_SUFFIX || '_live_data';
const STRATEGY_NAME = process.env.STRATEGY_NAME || 'msb';
const TARGET_TOPICS = [`${STRATEGY_NAME}${BACKTEST_TOPIC_SUFFIX}`, `${STRATEGY_NAME}${LIVE_TOPIC_SUFFIX}`];
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID;

const kafka = new Kafka({ clientId: 'stock-app', brokers: KAFKA_BROKERS });

const rootDir = process.env.SHARED_DIR || '.';

function getRedisKey(symbol, isTestMode) {
    const mode = isTestMode ? 'backtest' : 'live';
    let key = `strategies:${STRATEGY_NAME}:${mode}:${symbol}`;
    return key;
}

async function getMSBStrategyStateForSymbol(symbol, isTestMode = false) {
    try {
        let redisKey = getRedisKey(symbol, isTestMode);
        let data = {redisKey};  // read data from redis by util file.
        return data;
    } catch (error) {
        console.error(`Error reading MSB strategy for symbol ${symbol}:`, error.message);
        return null;
    }
}

async function writeMSBStrategyStateForSymbol(symbol, isTestMode = false, newState) {
    try {
        let redisKey = getRedisKey(symbol, isTestMode);
        // write newState to redisKey
        // write data to redis by util file.
    } catch (error) {
        console.error(`Error writing MSB strategy state for symbol ${symbol}:`, error.message);
    }
}

async function createConsumer() {
    const consumer = kafka.consumer({ groupId: TARGET_GROUP_ID, sessionTimeout: 30000 });

    await consumer.connect();

    // Subscribe to all topics in TARGET_TOPICS
    for (const topic of TARGET_TOPICS) {
        await consumer.subscribe({ topic, fromBeginning: false });
    }

    await consumer.run({
        eachMessage: async ({ message }) => {
            const symbol = message.key.toString();
            const isBackTest = topic === BACKTEST_TOPIC;
            console.log(`Received message for symbol ${symbol}`);
            const lastState = await getMSBStrategyStateForSymbol(symbol, isBackTest);
            const msg = JSON.parse(message.value.toString());

            let data = getLatestOHLCByInterval(msg, 'I1');
            let ltp = getLTP(msg);

            console.log(`Processing data for symbol ${symbol}:`, data);
            console.log(`Last Trade Price (LTP) for ${symbol}:`, ltp);

            // call the actual strategy function here
            let newState = MSB(lastState, data, symbol);

            await writeMSBStrategyStateForSymbol(symbol, isBackTest, newState);

            
        },
    });
}

createConsumer().catch(console.error);