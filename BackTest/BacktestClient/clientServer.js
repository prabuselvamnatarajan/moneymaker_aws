require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const { Kafka, Partitioners } = require('kafkajs');
const { sanitize, validateStreamQuery, appendMetadataToTick } = require('./streamHelper.js');

const app = express();
const PORT = process.env.CLIENT_PORT || 3000;
const WS_URL = process.env.WS_URL || 'ws://localhost:8085';

// Use environment variables with fallback defaults
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');

// Add topic from env variable with fallback
const KAFKA_TOPIC = process.env.KAFKA_TOPIC || 'backtest-stream-data';


if (!KAFKA_BROKERS) {
    throw new Error('KAFKA_BROKERS env variable is required');
}

const kafka = new Kafka({
    clientId: 'backtest-client',
    brokers: KAFKA_BROKERS,
    retry: {
        initialRetryTime: 300,
        retries: 20
    }
});
const producer = kafka.producer({
    createPartitioner: Partitioners.LegacyPartitioner
});

(async () => {
    await producer.connect();
})();

app.get('/', (req, res) => {
    const validated = validateStreamQuery(req.query);
    if (validated.error) {
        return res.status(validated.status).send(validated.error);
    }
    const { symbolName, date, timeMsNum, deployment_id, run_id, partitionKey } = validated.value;

    // Use topic from env variable
    const topic = KAFKA_TOPIC;

    // Log the WebSocket URL and payload for debugging
    console.log(`Starting WebSocket client for symbol: ${symbolName}, date: ${date}, time_ms: ${timeMsNum}, deployment_id: ${deployment_id}, run_id: ${run_id} at WS_URL: ${WS_URL}`);

    const ws = new WebSocket(WS_URL);

    ws.on('open', () => {
        const payload = { symbolName, date };
        if (time_ms !== undefined) {
            payload.time_ms = timeMsNum;
        }
        console.log('Sending payload to WebSocket:', payload);
        ws.send(JSON.stringify(payload));
    });

    let queue = [];
    let processing = false;

    async function processQueue() {
        if (processing) return;
        processing = true;
        while (queue.length > 0) {
            const batch = queue.splice(0, 100);
            const messages = batch.map(msg => ({ value: msg, key: symbolName }));
            try {
                await producer.send({
                    topic,
                    messages
                });
                console.log(`Sent batch of ${messages.length} messages to Kafka topic ${topic} with key ${symbolName}`);
            } catch (err) {
                console.error('Kafka produce error:', err.message);
            }
        }
        processing = false;
    }

    ws.on('message', (data) => {
        const msgStr = appendMetadataToTick(data, deployment_id, run_id);
        queue.push(msgStr);
        processQueue().catch(err => console.error('Error in processQueue:', err));
    });

    ws.on('close', () => {
        console.log('WebSocket connection closed');
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
        // Log more details if available
        if (err && err.message) {
            console.error('WebSocket error details:', err);
        }
    });

    res.send('WebSocket client started. Check server console for streamed data.');
});

app.listen(PORT, () => {
    console.log(`Express server listening on http://localhost:${PORT}`);
});
