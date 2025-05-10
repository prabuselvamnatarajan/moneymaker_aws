const { Kafka } = require('kafkajs');
const retry = require('async-retry');

// Use environment variables with fallback defaults
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');

const kafka = new Kafka({ clientId: 'stock-app', brokers: KAFKA_BROKERS });

async function processAndProduceMessages(data) {
    const producer = kafka.producer();
    await producer.connect();

    for (const [key, value] of Object.entries(data)) {
        const topic = "splited-live-data";
        console.log(`Processing ${key} data:`, value);
        console.log(`Topic : ${topic}`);

        await retry(async () => {
            await producer.send({
                topic,
                messages: [{ key, value: JSON.stringify(value) }],
            });
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

createConsumer().catch(console.error);