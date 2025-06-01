require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const { Kafka, Partitioners } = require('kafkajs');

const app = express();
const PORT = process.env.CLIENT_PORT || 3000;
const WS_URL = process.env.WS_URL || 'ws://localhost:8085';

// Use environment variables with fallback defaults
const KAFKA_BROKER = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');

// Add topic from env variable with fallback
const KAFKA_TOPIC = process.env.KAFKA_TOPIC || 'backtest-stream-data';


if (!KAFKA_BROKER) {
    throw new Error('KAFKA_BROKER env variable is required');
}

const kafka = new Kafka({
    clientId: 'backtest-client',
    brokers: KAFKA_BROKER
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

    const ws = new WebSocket(WS_URL);

    ws.on('open', () => {
        const payload = { symbolName, date };
        if (time_ms !== undefined) {
            payload.time_ms = timeMsNum;
        }
        ws.send(JSON.stringify(payload));
    });

    ws.on('message', async (data) => {
        //console.log('Received:', data.toString());
        // Produce to Kafka
        try {
            await producer.send({
                topic,
                messages: [{ value: data.toString(), key: partitionKey }]
            });
            console.log(`Message sent to Kafka topic ${topic} with key ${partitionKey}`);
        } catch (err) {
            console.error('Kafka produce error:', err.message);
        }
    });

    ws.on('close', () => {
        console.log('WebSocket connection closed');
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
    });

    res.send('WebSocket client started. Check server console for streamed data.');
});

app.listen(PORT, () => {
    console.log(`Express server listening on http://localhost:${PORT}`);
});
