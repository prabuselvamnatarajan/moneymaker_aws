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

        // BUY
        state = await MSB(
            state,
            candle({ high: 101, low: 100, ltp: 101 }),
            SYMBOL,
            strategyDetails()
        );

        resetStore({ balance: 100000, bought: { [holdingsKey()]: 50 }, orderFail: true });

        // Sell attempt fails
        state = await MSB(
            { ...state, prevHigh: { high: 101, low: 100.5 } },
            candle({ high: 100, low: 99, ltp: 99 }),
            SYMBOL,
            strategyDetails()
        );

        assert.equal(state.isUp, false);
        assert.equal(state.position?.direction, 'LONG', 'position must be retained when SELL order fails');
        assert.equal(store.bought[holdingsKey()], 50);
    });

    it('does not wipe LONG position on trend break UP if SELL order was skipped/failed', async () => {
        let state = {
            isUp: false,
            prevHigh: { high: 100, low: 95 },
            prevLow: { high: 96, low: 90 },
            position: { direction: 'LONG', entryPrice: 100 },
        };
        resetStore({ balance: 100000, bought: { [holdingsKey()]: 50 } });

        // Trend breaks UP (high: 97 > prevLow.high: 96)
        state = await MSB(
            state,
            candle({ high: 97, low: 91, ltp: 97 }),
            SYMBOL,
            strategyDetails()
        );

        assert.equal(state.position?.direction, 'LONG', 'LONG position must not be wiped by trend break UP');
        assert.equal(store.bought[holdingsKey()], 50);
    });
});
