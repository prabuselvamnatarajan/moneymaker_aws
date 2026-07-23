import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MSB } from '../MSB.js';
import { store, resetStore } from './mocks/account_utils.js';

const DEPLOYMENT_ID = 'dep-pts-1';
const SYMBOL = 'NSE_EQ|INE002A01018';

function strategyDetails(overrides = {}) {
    return {
        deployment_id: DEPLOYMENT_ID,
        account_id: 'acc-1',
        instrument_token: SYMBOL,
        use_full_amount: true,
        quantity: 1,
        isTest: true,
        advance_trade_decision: false,
        ...overrides,
    };
}

function candle({ high, low, ltp, timestamp = '2026-07-23T10:00:00.000Z' }) {
    return { high, low, ltp, timestamp };
}

function holdingsKey() {
    return `${DEPLOYMENT_ID}:${SYMBOL}`;
}

describe('msb_pts buy/sell consistency', () => {
    beforeEach(() => {
        process.env.PLACEORDER_API = 'http://localhost/placeorder';
        resetStore({ balance: 100000, bought: {} });
    });

    it('clears bought_quantity and position after successful trend-break SELL', async () => {
        let state = await MSB(null, candle({ high: 100, low: 99, ltp: 100 }), SYMBOL, strategyDetails());

        // Initial uptrend → BUY + LONG position
        state = await MSB(
            state,
            candle({ high: 101, low: 100, ltp: 101 }),
            SYMBOL,
            strategyDetails()
        );
        assert.equal(state.isUp, true);
        assert.equal(state.position?.direction, 'LONG');
        assert.ok(store.bought[holdingsKey()] > 0);

        // Trend break down → SELL
        state = await MSB(
            { ...state, prevHigh: { high: 101, low: 100.5 } },
            candle({ high: 100, low: 99, ltp: 99 }),
            SYMBOL,
            strategyDetails()
        );
        assert.equal(state.isUp, false);
        assert.equal(state.position, null);
        assert.equal(store.bought[holdingsKey()], 0);
        assert.equal(store.orders.filter((o) => o.transaction_type === 'SELL').length, 1);
    });

    it('keeps position and holdings when trend-break SELL fails', async () => {
        let state = await MSB(null, candle({ high: 100, low: 99, ltp: 100 }), SYMBOL, strategyDetails());
        state = await MSB(
            state,
            candle({ high: 101, low: 100, ltp: 101 }),
            SYMBOL,
            strategyDetails()
        );
        const qty = store.bought[holdingsKey()];
        assert.ok(qty > 0);
        assert.equal(state.position?.direction, 'LONG');

        store.orderFail = true;
        store.orders = [];

        state = await MSB(
            { ...state, prevHigh: { high: 101, low: 100.5 } },
            candle({ high: 100, low: 99, ltp: 99 }),
            SYMBOL,
            strategyDetails()
        );

        assert.equal(state.isUp, false);
        assert.equal(state.position?.direction, 'LONG', 'position must remain for retry');
        assert.equal(store.bought[holdingsKey()], qty, 'holdings must remain until successful exit');
    });
});
