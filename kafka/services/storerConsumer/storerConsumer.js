import { MongoClient } from 'mongodb';
import { Kafka } from 'kafkajs';
import retry from 'async-retry';
import { initLogger, logger } from '/app/utils/logUtils.js';

// Use environment variables with fallback defaults
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const TARGET_COLLECTION_NAME = process.env.TARGET_COLLECTION_NAME;
const TARGET_TOPIC = process.env.TARGET_TOPIC;
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID;

const kafka = new Kafka({
  clientId: 'stock-app',
  brokers: KAFKA_BROKERS,
  retry: {
    initialRetryTime: 300,
    retries: 20
  }
});

const client = new MongoClient(MONGO_URI);

async function storeInMongoDB(symbol, data) {
    logger.info(`Processing ${symbol} data:`, data);
    const db = client.db(TARGET_COLLECTION_NAME);
    const collection = db.collection(symbol);
    await collection.insertOne({ timestamp: new Date(), ...data });
}

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

    await connectWithRetry(client, 'MongoDB Client'); // Ensure MongoDB client is connected
    await connectWithRetry(consumer, 'Kafka Consumer');
    await consumer.subscribe({ topic: TARGET_TOPIC, fromBeginning: false });

    await consumer.run({
        eachMessage: async ({ message }) => {
            const symbol = message.key.toString();
            logger.info(`Received message for symbol ${symbol}`);
            const data = JSON.parse(message.value.toString());
            await retry(async () => {
                await storeInMongoDB(symbol, data);
            }, {
                retries: 5,
                minTimeout: 1000,
                onRetry: (error, attempt) => {
                    logger.warn(`Retry attempt ${attempt} for storing data due to error: ${error.message}`);
                }
            });
        },
    });
}

(async () => {
    await initLogger();
    await createConsumer();
})().catch((err) => {
    if (logger && logger.error) {
        logger.error('Unhandled error in storerConsumer', err);
    } else {
        // Fallback if logger isn't available
        console.error('Unhandled error in storerConsumer', err);
    }
    process.exit(1);
});