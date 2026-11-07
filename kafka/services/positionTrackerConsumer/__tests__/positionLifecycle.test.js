import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('positionTrackerConsumer Lifecycle & Cache Key Tests', () => {

    function openSymbolKey(symbol) {
        return `position:open:${String(symbol || '').toUpperCase()}`;
    }

    function liveKey(positionId) {
        return `position:live:${positionId}`;
    }

    function throttleKey(positionId) {
        return `position:throttle:unrealised:${positionId}`;
    }

    function isThrottleExpired(lastWriteTime, throttleMs = 2000, now = Date.now()) {
        const lastWrite = lastWriteTime ? parseInt(lastWriteTime, 10) : 0;
        return now - lastWrite >= throttleMs;
    }

    function buildCacheFromDoc(doc) {
        return {
            mongoId: String(doc._id),
            symbol: String(doc.symbol || '').toUpperCase(),
            type_of_position: doc.type_of_position,
            quantity: Number(doc.quantity) || 0,
            buy_price: Number(doc.buy_price) || 0,
            strategy_mode: doc.strategy_mode,
            deployment_id: doc.deployment_id ? String(doc.deployment_id) : null,
            backtest_run_id: doc.backtest_run_id ? String(doc.backtest_run_id) : null,
            maxUp: doc.max_profit != null ? Number(doc.max_profit) : 0,
            maxDown: doc.max_loss != null ? Number(doc.max_loss) : 0,
            maxUpPct: doc.max_profit_pct != null ? Number(doc.max_profit_pct) : 0,
            maxDownPct: doc.max_loss_pct != null ? Number(doc.max_loss_pct) : 0,
            unrealised_pnl: doc.unrealised_pnl != null ? Number(doc.unrealised_pnl) : 0,
            last_ltp: doc.last_ltp != null ? Number(doc.last_ltp) : null,
            status: doc.status || 'OPEN',
        };
    }

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
        assert.equal(isThrottleExpired(7000, 2000, now), true);  // 3000ms >= 2000ms
        assert.equal(isThrottleExpired(9000, 2000, now), false); // 1000ms < 2000ms
        assert.equal(isThrottleExpired(0, 2000, now), true);    // initial state
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
        assert.equal(cache.symbol, 'INFY');
        assert.equal(cache.quantity, 50);
        assert.equal(cache.buy_price, 1450.75);
        assert.equal(cache.maxUp, 100);
        assert.equal(cache.maxDown, -50);
        assert.equal(cache.status, 'OPEN');
    });
});
