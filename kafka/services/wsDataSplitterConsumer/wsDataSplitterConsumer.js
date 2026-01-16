import { Kafka } from 'kafkajs';
import retry from 'async-retry';
import RedisPubSub from "./redis_utils/redis_operations/RedisPubSub.js";
import { calculateLatency } from './utils/latencyUtil.js';

// Use environment variables with fallback defaults
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const LIVE_PREFIX = process.env.LIVE_PREFIX || "live";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const kafka = new Kafka({ clientId: 'stock-app', brokers: KAFKA_BROKERS });
const redisPubSub = new RedisPubSub({ url: REDIS_URL });

async function processAndProduceMessages(data) {
    const producer = kafka.producer();
    await producer.connect();

    for (const [key, value] of Object.entries(data)) {
        value.latency = {
            beforeSplit: calculateLatency(value)
        };
        const topic = "splited-live-data";
        value.symbol_name = key; // adding symbol_name to value
        console.log(`Processing ${key} data:`, value);
        console.log(`Topic : ${topic}`);

        let redisPublishChannel = `${LIVE_PREFIX}:${key.replace(/'/g, "")}`;

        await retry(async () => {
            let msg = JSON.stringify(value);
            await producer.send({
                topic,
                messages: [{ key, value: msg }],
            });
            console.log(`redisPublishChannel : ${redisPublishChannel} with message: ${msg}`);
            await redisPubSub.publish(redisPublishChannel, msg);
        }, {
            retries: 5,
            minTimeout: 1000,
            onRetry: (error, attempt) => {
                console.log(`Retry attempt ${attempt} for topic ${topic} due to error: ${error.message}`);
            }
        });
    }

    await producer.disconnect();
}

async function createConsumer() {   
    const consumer = kafka.consumer({ groupId: 'WS_data_splitter', sessionTimeout: 30000 });

    try {
        await consumer.connect();
        await consumer.subscribe({ topic: 'incoming-ws-msg', fromBeginning: false });

        await consumer.run({
            eachMessage: async ({ message }) => {
                try {
                    const data = JSON.parse(message.value.toString());
                    await processAndProduceMessages(data);
                } catch (error) {
                    console.error('Error processing message:', error);
                }
            },
        });
    } catch (error) {
        console.error('Error in consumer setup:', error);
    }
}

async function startServer() {
    try {
        await redisPubSub.connect();
        createConsumer().catch(console.error);
    } catch (error) {
        console.error('Error starting server:', error);
    }
}

startServer();