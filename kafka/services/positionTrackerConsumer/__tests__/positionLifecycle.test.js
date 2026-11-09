import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    openSymbolKey,
    liveKey,
    throttleKey,
    checkThrottleExpired,
    buildCacheFromDoc,
} from '../cacheHelpers.js';

describe('positionTrackerConsumer Lifecycle & Cache Key Tests (Real Codebase)', () => {

    it('generates normalized uppercase open symbol key', () => {
        assert.equal(openSymbolKey('reliance'), 'position:open:RELIANCE');
        assert.equal(openSymbolKey('Nifty 50'), 'position:open:NIFTY 50');
    });

    it('generates live position and throttle redis keys', () => {
        assert.equal(liveKey('pos_123'), 'position:live:pos_123');
        assert.equal(throttleKey('pos_123'), 'position:throttle:unrealised:pos_123');
    });

    it('throttle expiration: allows write when elapsed time >= throttleMs', () => {
        const now = 10000;
        assert.equal(checkThrottleExpired(7000, 2000, now), true);  // 3000ms >= 2000ms
        assert.equal(checkThrottleExpired(9000, 2000, now), false); // 1000ms < 2000ms
        assert.equal(checkThrottleExpired(0, 2000, now), true);    // initial state
    });

    it('buildCacheFromDoc coerces numeric fields and normalizes status and symbol', () => {
        const doc = {
            _id: '60d5ec49f1b2c8a1c8f1b2c8',
            symbol: 'infy',
            type_of_position: 'LONG',
            quantity: '50',
            buy_price: '1450.75',
            strategy_mode: 'LIVE',
            deployment_id: 'dep_1',
            max_profit: '100',
            max_loss: '-50',
        };
        const cache = buildCacheFromDoc(doc);
        assert.equal(cache.mongoId, '60d5ec49f1b2c8a1c8f1b2c8');
        assert.equal(cache.positionMongoId, '60d5ec49f1b2c8a1c8f1b2c8');
        assert.equal(cache.symbol, 'INFY');
        assert.equal(cache.quantity, 50);
        assert.equal(cache.openSize, 50);
        assert.equal(cache.buy_price, 1450.75);
        assert.equal(cache.entryPrice, 1450.75);
        assert.equal(cache.maxUp, 100);
        assert.equal(cache.maxDown, -50);
        assert.equal(cache.status, 'OPEN');
    });
});
