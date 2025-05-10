const { MongoClient } = require('mongodb');
const { Kafka } = require('kafkajs');
const retry = require('async-retry');

// Use environment variables with fallback defaults
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const TARGET_COLLECTION_NAME = process.env.TARGET_COLLECTION_NAME;
const TARGET_TOPIC = process.env.TARGET_TOPIC;
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID;

const kafka = new Kafka({ clientId: 'stock-app', brokers: KAFKA_BROKERS });
const client = new MongoClient(MONGO_URI);

async function storeInMongoDB(symbol, data) {
    console.log(`Processing ${symbol} data:`, data);
    const db = client.db(TARGET_COLLECTION_NAME);
    const collection = db.collection(symbol);
    await collection.insertOne({ timestamp: new Date(), ...data });
}

async function createConsumer() {
    const consumer = kafka.consumer({ groupId: TARGET_GROUP_ID, sessionTimeout: 30000 });

    await client.connect(); // Ensure MongoDB client is connected
    await consumer.connect();
    await consumer.subscribe({ topic: TARGET_TOPIC, fromBeginning: false });

    await consumer.run({
        eachMessage: async ({ message }) => {
            const symbol = message.key.toString();
            console.log(`Received message for symbol ${symbol}`);
            const data = JSON.parse(message.value.toString());
            await retry(async () => {
                await storeInMongoDB(symbol, data);
            }, {
                retries: 5,
                minTimeout: 1000,
                onRetry: (error, attempt) => {
                    console.log(`Retry attempt ${attempt} for storing data due to error: ${error.message}`);
                }
            });
        },
    });
}

createConsumer().catch(console.error);