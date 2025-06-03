const { Kafka } = require('kafkajs');
const MSB = require('./MSB');
const { getLatestOHLCByInterval, getLTP } = require('./utils');
const fs = require('fs').promises;

// Use environment variables with fallback defaults
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const TARGET_TOPICS = (process.env.TARGET_TOPIC || '').split(',').map(t => t.trim()).filter(Boolean);
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID;
const BACKTEST_TOPIC = process.env.BACKTEST_TOPIC || 'backtest-stream-data';

const kafka = new Kafka({ clientId: 'stock-app', brokers: KAFKA_BROKERS });

const rootDir = process.env.SHARED_DIR || '.';

async function getMSBStrategyStateForSymbol(symbol, isBackTest = false) {
    try {
        const fileName = isBackTest ? 'backtest' : 'live';
        const filePath = `${rootDir}/strategy/MSB/${fileName}/${symbol}.json`;
        const fileContent = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(fileContent); // Return parsed JSON data
    } catch (error) {
        console.error(`Error reading MSB strategy for symbol ${symbol}:`, error.message);
        return null;
    }
}

async function writeMSBStrategyStateForSymbol(symbol, newState) {
    try {
        const filePath = `${rootDir}/strategy/MSB/${symbol}.json`;
        const fileContent = JSON.stringify(newState, null, 2); // Format JSON with indentation
        await fs.writeFile(filePath, fileContent, 'utf-8');
        console.log(`Successfully wrote MSB strategy state for symbol ${symbol}`);
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

            await writeMSBStrategyStateForSymbol(symbol, newState);

            
        },
    });
}

createConsumer().catch(console.error);