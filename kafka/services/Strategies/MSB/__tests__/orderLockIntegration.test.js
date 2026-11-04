import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MsbStrategy } from '../MSB.js';
import { store, resetStore } from './mocks/account_utils.js';

const DEPLOYMENT_ID = 'dep-msb-lock-test-1';
const SYMBOL = 'NSE_EQ|INE002A01018';

function strategyDetails(overrides = {}) {
    return {
        deployment_id: DEPLOYMENT_ID,
        account_id: 'acc-msb-lock-1',
        instrument_token: SYMBOL,
        use_full_amount: true,
        quantity: 1,
        isTest: true,
        ...overrides,
    };
}

function candle({ high, low, ltp, timestamp = '2026-07-29T10:00:00.000Z' }) {
    return { high, low, ltp, timestamp };
}

describe('MSB Order Lock & Concurrent Tick Integration Test', () => {
    /** @type {MsbStrategy} */
    let strategy;

    beforeEach(() => {
        process.env.PLACEORDER_API = 'http://localhost/placeorder';
        process.env.NODE_ENV = 'test';
        resetStore({ balance: 100000, bought: {} });
        strategy = new MsbStrategy();
    });

    it('successfully acquires Redis order lock and places order', async () => {
        let state = await strategy.executeStrategy(null, candle({ high: 100, low: 99, ltp: 100 }), SYMBOL, strategyDetails());

        // First breakout tick triggers BUY
        state = await strategy.executeStrategy(
            state,
            candle({ high: 101, low: 100, ltp: 101 }),
            SYMBOL,
            strategyDetails()
        );

        assert.equal(state.isUp, true);
        assert.ok(store.orders.length === 1, 'Exactly one order should be placed');
        assert.equal(store.orders[0].transaction_type, 'BUY');
        assert.ok(store.bought[`${DEPLOYMENT_ID}:${SYMBOL}`] > 0, 'Redis holdings must be populated after order success');
    });

    it('rejects duplicate concurrent tick order placement while lock is held', async () => {
        let state = await strategy.executeStrategy(null, candle({ high: 100, low: 99, ltp: 100 }), SYMBOL, strategyDetails());

        const { acquireOrderLockInRedis, releaseOrderLockInRedis } = await import('./mocks/account_utils.js');
        const lockAcquired = await acquireOrderLockInRedis(SYMBOL, DEPLOYMENT_ID);
        assert.equal(lockAcquired, true, 'Lock should initially be available');

        // Next breakout tick arrives while lock is held by in-flight order
        state = await strategy.executeStrategy(
            state,
            candle({ high: 101, low: 100, ltp: 101 }),
            SYMBOL,
            strategyDetails()
        );

        assert.equal(store.orders.length, 0, 'No order should be placed while lock is held');

        // Release lock
        await releaseOrderLockInRedis(SYMBOL, DEPLOYMENT_ID);

        // Trend breaks DOWN (high: 101, low: 98 < prevHigh.low: 99)
        // With isUp null, low < 99 establishes DOWN trend without order
        // Then breakout UP triggers BUY
        let downState = await strategy.executeStrategy(null, candle({ high: 100, low: 99, ltp: 100 }), SYMBOL, strategyDetails());
        downState = await strategy.executeStrategy(downState, candle({ high: 100, low: 97, ltp: 97 }), SYMBOL, strategyDetails());
        assert.equal(downState.isUp, false);

        // Breakout UP triggers BUY
        downState = await strategy.executeStrategy(downState, candle({ high: 102, low: 101, ltp: 102 }), SYMBOL, strategyDetails());
        assert.equal(store.orders.length, 1, 'Order should be placed after lock release');
    });
});
