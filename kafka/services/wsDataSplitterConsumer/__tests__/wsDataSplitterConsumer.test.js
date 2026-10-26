import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { connectWithRetry } from '../connectUtils.js';

describe('connectWithRetry', () => {
    // We can use a mock logger to verify it works without throwing
    const mockLogger = {
        infoCalled: 0,
        warnCalled: 0,
        info: () => { mockLogger.infoCalled++; },
        warn: () => { mockLogger.warnCalled++; }
    };

    it('should connect successfully on the first attempt', async () => {
        let connectCalled = 0;
        const mockTarget = {
            connect: async () => {
                connectCalled++;
                return Promise.resolve();
            }
        };
        mockLogger.infoCalled = 0;

        await connectWithRetry(mockTarget, 'TestTarget', 3, 10, mockLogger);
        assert.equal(connectCalled, 1);
        assert.equal(mockLogger.infoCalled, 1);
    });

    it('should retry on failure and eventually succeed', async () => {
        let connectCalled = 0;
        const mockTarget = {
            connect: async () => {
                connectCalled++;
                if (connectCalled < 3) {
                    throw new Error('Connection failed');
                }
                return Promise.resolve();
            }
        };
        mockLogger.warnCalled = 0;
        mockLogger.infoCalled = 0;

        await connectWithRetry(mockTarget, 'TestTarget', 5, 10, mockLogger);
        assert.equal(connectCalled, 3);
        assert.equal(mockLogger.warnCalled, 2);
        assert.equal(mockLogger.infoCalled, 1);
    });

    it('should throw an error if maximum retries are exceeded', async () => {
        let connectCalled = 0;
        const mockTarget = {
            connect: async () => {
                connectCalled++;
                throw new Error('Connection failed forever');
            }
        };

        await assert.rejects(
            async () => {
                await connectWithRetry(mockTarget, 'TestTarget', 3, 10, mockLogger);
            },
            {
                name: 'Error',
                message: 'Failed to connect to TestTarget after maximum retries.'
            }
        );
        assert.equal(connectCalled, 3);
    });
});
