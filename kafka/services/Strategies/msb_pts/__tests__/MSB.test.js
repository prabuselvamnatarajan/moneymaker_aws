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

    it('15m Timeframe: ignores intra-bar ticks for MSB breakouts but executes real-time Target/SL immediately', async () => {
        resetStore({ balance: 100000, bought: {} });
        const details = strategyDetails({
            timeframe: '15m',
            advance_trade_decision: true,
            target_pts: 10,
            sl_pts: 5,
        });

        // 1. Position is OPEN at entryPrice = 100 in DOWN trend context
        let state = {
            isUp: false,
            prevHigh: { high: 105, low: 104 },
            prevLow: { high: 100, low: 99 },
            position: { direction: 'LONG', entryPrice: 100 },
        };
        resetStore({ balance: 100000, bought: { [holdingsKey()]: 10 } });

        // 2. Intra-bar tick arrives at 09:18:00 (mid-bar, isClosed: false) with LTP = 110 (Target hit!)
        const tickMidBarTarget = { high: 110, low: 99, ltp: 110, isClosed: false };

        state = await MSB(state, tickMidBarTarget, null, SYMBOL, details);

        assert.equal(store.orders.length, 1, 'Target exit must fire immediately on intra-bar tick without waiting for candle close');
        assert.equal(store.orders[0].transaction_type, 'SELL');
        assert.equal(state.position, null, 'Position must be cleared on Target hit');

        // 3. Additional intra-bar ticks arrive during forming 15m candle — no new MSB breakout entries must fire
        const formingTick = { high: 108, low: 97, ltp: 108, isClosed: false };
        for (let i = 0; i < 10; i++) {
            state = await MSB(state, formingTick, null, SYMBOL, details);
        }

        assert.equal(store.orders.length, 1, 'No new MSB entry orders must fire on intra-bar ticks');

        // 4. Closed 15m candle arrives at 09:30:01 AM
        const closed15mCandle = { open: 98, high: 108, low: 97, close: 107, isClosed: true };
        state = await MSB(state, formingTick, closed15mCandle, SYMBOL, details);

        // Trend breaks UP on closed candle -> new LONG entry
        assert.equal(store.orders.length, 2, 'New MSB entry order fires ONLY on closed 15m candle');
        assert.equal(store.orders[1].transaction_type, 'BUY');
    });
});
