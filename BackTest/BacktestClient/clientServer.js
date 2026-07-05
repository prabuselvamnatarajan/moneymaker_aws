require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const { Kafka, Partitioners } = require('kafkajs');

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

function sanitize(str) {
    return String(str).replace(/[^a-zA-Z0-9]/g, '_');
}

(async () => {
    await producer.connect();
})();

app.get('/', (req, res) => {
    const { symbolName, date, time_ms } = req.query;
    if (!symbolName || !date) {
        return res.status(400).send('Missing symbolName or date');
    }

    // Default time_ms to 0 if not provided
    let timeMsNum = 0;
    if (time_ms !== undefined) {
        timeMsNum = Number(time_ms);
        if (isNaN(timeMsNum) || timeMsNum < 0) {
            return res.status(400).send('Invalid time_ms: must be a number >= 0');
        }
    }

    // Sanitize topic parts
    // Use topic from env variable
    const topic = KAFKA_TOPIC;
    const partitionKey = `backtest-${sanitize(symbolName)}-${sanitize(date)}-${sanitize(timeMsNum)}`;

    // Log the WebSocket URL and payload for debugging
    console.log(`Starting WebSocket client for symbol: ${symbolName}, date: ${date}, time_ms: ${timeMsNum} at WS_URL: ${WS_URL}`);

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
        queue.push(data.toString());
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
