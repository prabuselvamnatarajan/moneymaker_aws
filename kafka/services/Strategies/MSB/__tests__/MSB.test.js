import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MSB } from '../MSB.js';
import { store, resetStore } from './mocks/account_utils.js';

const DEPLOYMENT_ID = 'dep-test-1';
const SYMBOL = 'NSE_EQ|INE002A01018';

function strategyDetails(overrides = {}) {
    return {
        deployment_id: DEPLOYMENT_ID,
        account_id: 'acc-1',
        instrument_token: SYMBOL,
        use_full_amount: true,
        quantity: 1,
        isTest: true,
        ...overrides,
    };
}

function candle({ high, low, ltp, timestamp = '2026-07-23T10:00:00.000Z' }) {
    return { high, low, ltp, timestamp };
}

function holdingsKey() {
    return `${DEPLOYMENT_ID}:${SYMBOL}`;
}

describe('MSB buy/sell consistency', () => {
    beforeEach(() => {
        process.env.PLACEORDER_API = 'http://localhost/placeorder';
        resetStore({ balance: 100000, bought: {} });
    });

    it('clears bought_quantity after successful SELL (buy→sell cycle)', async () => {
        let state = await MSB(null, candle({ high: 100, low: 99, ltp: 100 }), SYMBOL, strategyDetails());

        // Uptrend break → BUY
        state = await MSB(
            state,
            candle({ high: 101, low: 100, ltp: 101 }),
            SYMBOL,
            strategyDetails()
        );
        assert.equal(state.isUp, true);
        assert.ok(store.bought[holdingsKey()] > 0, 'expected holdings after BUY');
        const buyOrders = store.orders.filter((o) => o.transaction_type === 'BUY');
        assert.equal(buyOrders.length, 1);

        // Downtrend break → SELL should clear holdings
        state = await MSB(
            { ...state, prevHigh: { high: 101, low: 100.5 } },
            candle({ high: 100, low: 99, ltp: 99 }),
            SYMBOL,
            strategyDetails()
        );
        assert.equal(state.isUp, false);
        assert.equal(store.bought[holdingsKey()], 0);
        const sellOrders = store.orders.filter((o) => o.transaction_type === 'SELL');
        assert.equal(sellOrders.length, 1);
    });

    it('skips SELL when there are no holdings', async () => {
        resetStore({ balance: 100000, bought: {} });
        const state = {
            isUp: true,
            prevHigh: { high: 101, low: 100.5 },
            prevLow: { high: 100, low: 99 },
        };

        await MSB(
            state,
            candle({ high: 100, low: 99, ltp: 99 }),
            SYMBOL,
            strategyDetails()
        );

        assert.equal(store.orders.length, 0, 'must not place SELL without holdings');
        assert.equal(store.bought[holdingsKey()] || 0, 0);
    });

    it('does not set bought_quantity when BUY order fails', async () => {
        resetStore({ balance: 100000, bought: {}, orderFail: true });
        let state = await MSB(null, candle({ high: 100, low: 99, ltp: 100 }), SYMBOL, strategyDetails());

        state = await MSB(
            state,
            candle({ high: 101, low: 100, ltp: 101 }),
            SYMBOL,
            strategyDetails()
        );

        assert.equal(state.isUp, true);
        assert.equal(store.bought[holdingsKey()] || 0, 0);
    });

    it('does not repeat SELL after holdings were cleared', async () => {
        let state = await MSB(null, candle({ high: 100, low: 99, ltp: 100 }), SYMBOL, strategyDetails());

        // BUY
        state = await MSB(
            state,
            candle({ high: 101, low: 100, ltp: 101 }),
            SYMBOL,
            strategyDetails()
        );
        assert.ok(store.bought[holdingsKey()] > 0);

        // First SELL clears holdings
        state = await MSB(
            { ...state, prevHigh: { high: 101, low: 100.5 } },
            candle({ high: 100, low: 99, ltp: 99 }),
            SYMBOL,
            strategyDetails()
        );
        assert.equal(store.bought[holdingsKey()], 0);
        assert.equal(store.orders.filter((o) => o.transaction_type === 'SELL').length, 1);

        // Failed BUY (no balance) then another downtrend must not SELL again
        resetStore({
            balance: 0,
            bought: { [holdingsKey()]: 0 },
        });
        // keep prior orders count by not resetting orders mid-test — re-seed after tracking
        const sellCountBefore = 0;

        // Uptrend break with zero balance → skip BUY
        state = await MSB(
            { ...state, isUp: false, prevLow: { high: 99.5, low: 99 } },
            candle({ high: 101, low: 100, ltp: 101 }),
            SYMBOL,
            strategyDetails()
        );
        assert.equal(state.isUp, true);
        assert.equal(store.orders.filter((o) => o.transaction_type === 'BUY').length, sellCountBefore);

        // Downtrend again — no holdings → no SELL
        state = await MSB(
            { ...state, prevHigh: { high: 101, low: 100.5 } },
            candle({ high: 100, low: 99, ltp: 99 }),
            SYMBOL,
            strategyDetails()
        );
        assert.equal(store.orders.filter((o) => o.transaction_type === 'SELL').length, 0);
    });
});
