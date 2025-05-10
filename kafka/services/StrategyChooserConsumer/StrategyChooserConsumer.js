const { Kafka } = require('kafkajs');
const fs = require('fs').promises;

// Use environment variables with fallback defaults
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const TARGET_TOPIC = process.env.TARGET_TOPIC;
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID;
const BACKTEST_TOPIC_PREFIX = process.env.BACKTEST_TOPIC_PREFIX || 'backtest-';

const kafka = new Kafka({ clientId: 'stock-app', brokers: KAFKA_BROKERS });

const rootDir = process.env.SHARED_DIR || '.';

async function getStrategiesForSymbol(isBackTest, symbol) {
    try {
        const fileName = isBackTest ? 'backtest' : 'live';
        const filePath = `${rootDir}/strategyChooser/${fileName}/${symbol}.json`;
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const { activeStrategies = [] } = JSON.parse(fileContent);
        return activeStrategies;
    } catch (error) {
        console.error(`Error reading strategies for symbol ${symbol}:`, error.message);
        return [];
    }
}

async function createConsumer() {
    const consumer = kafka.consumer({ groupId: TARGET_GROUP_ID, sessionTimeout: 30000 });
    const producer = kafka.producer();

    await consumer.connect();
    await producer.connect();

    // Always subscribe to both live and backtest topics
    await consumer.subscribe({ topic: TARGET_TOPIC, fromBeginning: false });
    await consumer.subscribe({ topic: new RegExp(`^${BACKTEST_TOPIC_PREFIX}`), fromBeginning: false });

    await consumer.run({
        eachMessage: async ({ topic, message: { key, value } }) => {
            const symbol = key.toString();
            const isBackTest = topic.startsWith(BACKTEST_TOPIC_PREFIX);
            console.log(`Received message for symbol ${symbol} on topic ${topic} (isBackTest: ${isBackTest})`);
            const strategies = await getStrategiesForSymbol(isBackTest, symbol);
            console.log(`Active strategies for ${symbol}:`, strategies);
            const data = JSON.parse(value.toString());

            await Promise.all(strategies.map(async (strategyName) => {
                try {
                    const topicName = isBackTest
                        ? `${strategyName}_backtest_data`
                        : `${strategyName}_live_data`;
                    await producer.send({
                        topic: topicName,
                        messages: [
                            { key: symbol, value: JSON.stringify(data) },
                        ],
                    });
                    console.log(`Produced message to topic ${topicName} with key ${symbol}`);
                } catch (error) {
                    console.error(`Failed to produce message to topic ${strategyName}_live_data for symbol ${symbol}:`, error.message);
                }
            }));
        },
    });
}

createConsumer().catch(console.error);