import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    splitAndTransformBatch,
    getCalculateLatency,
    retryOperation,
    connectWithRetry,
} from '../batchSplitter.js';

const calculateLatency = await getCalculateLatency();

describe('wsDataSplitterConsumer Unit & Edge Case Tests (Real Codebase)', () => {

    it('TC-WDS-001: Multi-symbol batch is split into one Kafka message per symbol', () => {
        const batch = {
            RELIANCE: { ltp: 2500, ltpc: { ltp: 2500, ltt: Date.now() - 50 } },
            TCS: { ltp: 3800, ltpc: { ltp: 3800, ltt: Date.now() - 60 } },
        };

        const { kafkaMessages } = splitAndTransformBatch(batch, 'live', calculateLatency);
        assert.equal(kafkaMessages.length, 2);

        const relianceMsg = kafkaMessages.find((m) => m.key === 'RELIANCE');
        assert.ok(relianceMsg);
        assert.equal(relianceMsg.topic, 'splited-live-data');
        assert.equal(relianceMsg.parsed.symbol_name, 'RELIANCE');
        assert.equal(relianceMsg.parsed.ltp, 2500);

        const tcsMsg = kafkaMessages.find((m) => m.key === 'TCS');
        assert.ok(tcsMsg);
        assert.equal(tcsMsg.parsed.symbol_name, 'TCS');
        assert.equal(tcsMsg.parsed.ltp, 3800);
    });

    it('TC-WDS-002: Each symbol is also published to its own Redis channel', () => {
        const batch = {
            INFY: { ltp: 1800, ltpc: { ltp: 1800, ltt: Date.now() } },
            HDFC: { ltp: 1600, ltpc: { ltp: 1600, ltt: Date.now() } },
        };

        const { redisPublishes } = splitAndTransformBatch(batch, 'live', calculateLatency);
        assert.equal(redisPublishes.length, 2);
        assert.equal(redisPublishes[0].channel, 'live:INFY');
        assert.equal(redisPublishes[1].channel, 'live:HDFC');
        assert.ok(redisPublishes[0].message.includes('"symbol_name":"INFY"'));
    });

    it('TC-WDS-003: Latency metadata attached before split', () => {
        const now = Date.now();
        const batch = {
            SBIN: { ltpc: { ltp: 750, ltt: now - 120 } },
        };

        const { kafkaMessages } = splitAndTransformBatch(batch, 'live', calculateLatency);
        assert.equal(kafkaMessages.length, 1);
        const latency = kafkaMessages[0].parsed.latency.beforeSplit;
        assert.ok(typeof latency === 'number');
        assert.ok(latency >= 100);
    });

    it('TC-WDS-004: Symbol names containing single quotes are sanitized in Redis channel name', () => {
        const batch = {
            "M&M'S": { ltp: 500 },
            "O'REILLY": { ltp: 950 },
        };

        const { redisPublishes } = splitAndTransformBatch(batch, 'live', calculateLatency);
        assert.equal(redisPublishes[0].channel, 'live:M&MS');
        assert.equal(redisPublishes[1].channel, 'live:OREILLY');
    });

    it('TC-WDS-010: Empty object {} produces zero downstream messages', () => {
        const { kafkaMessages, redisPublishes } = splitAndTransformBatch({}, 'live', calculateLatency);
        assert.equal(kafkaMessages.length, 0);
        assert.equal(redisPublishes.length, 0);
    });

    it('TC-WDS-009: Malformed non-JSON input throws fast and loud', () => {
        assert.throws(
            () => {
                const malformed = 'not-json-string';
                JSON.parse(malformed);
            },
            { name: 'SyntaxError' }
        );

        assert.throws(
            () => {
                splitAndTransformBatch(null, 'live', calculateLatency);
            },
            { message: /Invalid payload/ }
        );
    });

    it('TC-WDS-005 & TC-WDS-007: Retry helper successfully executes or exhausts budget', async () => {
        let attempts = 0;
        async function mockFailingOperation(succeedAtAttempt = 3) {
            attempts++;
            if (attempts < succeedAtAttempt) {
                throw new Error('Transient Kafka Broker Error');
            }
            return 'SUCCESS';
        }

        const result = await retryOperation(() => mockFailingOperation(3), 5);
        assert.equal(result, 'SUCCESS');
        assert.equal(attempts, 3);

        // Exhaustion case
        attempts = 0;
        await assert.rejects(
            async () => {
                await retryOperation(() => mockFailingOperation(10), 3);
            },
            { message: /Exhausted retries/ }
        );
    });

    it('TC-WDS-013: Connection retry helper connects or fails loudly after max attempts', async () => {
        let connectCalls = 0;
        const mockClient = {
            connect: async () => {
                connectCalls++;
                throw new Error('Connection refused');
            },
        };

        await assert.rejects(
            async () => {
                await connectWithRetry(mockClient, 'MockService', 3, 0, { warn: () => {}, info: () => {} });
            },
            { message: /Failed to connect after 3 attempts/ }
        );
        assert.equal(connectCalls, 3);
    });
});
