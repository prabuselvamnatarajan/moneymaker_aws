import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MsbStrategy } from '../MSB.js';
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
    /** @type {MsbStrategy} */
    let strategy;

    beforeEach(() => {
        process.env.PLACEORDER_API = 'http://localhost/placeorder';
        process.env.NODE_ENV = 'test';
        resetStore({ balance: 100000, bought: {} });
        strategy = new MsbStrategy();
    });

    it('clears bought_quantity after successful SELL (buy→sell cycle)', async () => {
        let state = await strategy.executeStrategy(null, candle({ high: 100, low: 99, ltp: 100 }), SYMBOL, strategyDetails());

        // Uptrend break → BUY
        state = await strategy.executeStrategy(
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
        state = await strategy.executeStrategy(
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

        await strategy.executeStrategy(
            state,
            candle({ high: 100, low: 99, ltp: 99 }),
            SYMBOL,
            strategyDetails()
        );

        assert.equal(store.orders.length, 0, 'must not place SELL without holdings');
        assert.equal(store.bought[holdingsKey()] || 0, 0);
    });

    it('skips BUY when Redis already has holdings (no overwrite)', async () => {
        resetStore({
            balance: 100000,
            bought: { [holdingsKey()]: 75 },
        });
        let state = await strategy.executeStrategy(null, candle({ high: 100, low: 99, ltp: 100 }), SYMBOL, strategyDetails());
        state = await strategy.executeStrategy(
            state,
            candle({ high: 101, low: 100, ltp: 101 }),
            SYMBOL,
            strategyDetails()
        );
        assert.equal(state.isUp, true);
        assert.equal(store.bought[holdingsKey()], 75, 'must not overwrite preserved holdings');
        assert.equal(store.orders.filter((o) => o.transaction_type === 'BUY').length, 0);
    });

    it('does not set bought_quantity when BUY order fails', async () => {
        resetStore({ balance: 100000, bought: {}, orderFail: true });
        let state = await strategy.executeStrategy(null, candle({ high: 100, low: 99, ltp: 100 }), SYMBOL, strategyDetails());

        state = await strategy.executeStrategy(
            state,
            candle({ high: 101, low: 100, ltp: 101 }),
            SYMBOL,
            strategyDetails()
        );

        assert.equal(state.isUp, true);
        assert.equal(store.bought[holdingsKey()] || 0, 0);
    });

    it('recovers from empty prevHigh/prevLow state and places BUY on break', async () => {
        const corruptState = { isUp: null, prevHigh: {}, prevLow: {} };
        const recovered = await strategy.executeStrategy(
            corruptState,
            candle({ high: 100, low: 99, ltp: 100 }),
            SYMBOL,
            strategyDetails()
        );
        assert.equal(recovered.prevHigh.high, 100);
        assert.equal(recovered.prevLow.low, 99);

        const afterBreak = await strategy.executeStrategy(
            recovered,
            candle({ high: 101, low: 100, ltp: 101 }),
            SYMBOL,
            strategyDetails()
        );
        assert.equal(afterBreak.isUp, true);
        assert.ok(store.bought[holdingsKey()] > 0);
    });

    it('does not repeat SELL after holdings were cleared', async () => {
        let state = await strategy.executeStrategy(null, candle({ high: 100, low: 99, ltp: 100 }), SYMBOL, strategyDetails());

        // BUY
        state = await strategy.executeStrategy(
            state,
            candle({ high: 101, low: 100, ltp: 101 }),
            SYMBOL,
            strategyDetails()
        );
        assert.ok(store.bought[holdingsKey()] > 0);

        // First SELL clears holdings
        state = await strategy.executeStrategy(
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
        state = await strategy.executeStrategy(
            { ...state, isUp: false, prevLow: { high: 99.5, low: 99 } },
            candle({ high: 101, low: 100, ltp: 101 }),
            SYMBOL,
            strategyDetails()
        );
        assert.equal(state.isUp, true);
        assert.equal(store.orders.filter((o) => o.transaction_type === 'BUY').length, sellCountBefore);

        // Downtrend again — no holdings → no SELL
        state = await strategy.executeStrategy(
            { ...state, prevHigh: { high: 101, low: 100.5 } },
            candle({ high: 100, low: 99, ltp: 99 }),
            SYMBOL,
            strategyDetails()
        );
        assert.equal(store.orders.filter((o) => o.transaction_type === 'SELL').length, 0);
    });

    it('establishes initial DOWN trend when isUp === null and price breaks down', async () => {
        let state = await strategy.executeStrategy(null, candle({ high: 100, low: 99, ltp: 100 }), SYMBOL, strategyDetails());
        assert.equal(state.isUp, null);

        // Down break from initial state
        state = await strategy.executeStrategy(
            state,
            candle({ high: 99, low: 97, ltp: 97 }),
            SYMBOL,
            strategyDetails()
        );
        assert.equal(state.isUp, false, 'expected isUp to become false on initial down break');
    });

    it('falls back to default quantity when balance key is missing or lot_size is non-full-amount', async () => {
        resetStore({ balance: null, bought: {} });
        let state = await strategy.executeStrategy(null, candle({ high: 100, low: 99, ltp: 100 }), SYMBOL, strategyDetails({ use_full_amount: false, lot_size: 50, no_of_lots: 2 }));
        state = await strategy.executeStrategy(
            state,
            candle({ high: 101, low: 100, ltp: 101 }),
            SYMBOL,
            strategyDetails({ use_full_amount: false, lot_size: 50, no_of_lots: 2 })
        );
        assert.equal(state.isUp, true);
        const buyOrders = store.orders.filter((o) => o.transaction_type === 'BUY');
        assert.equal(buyOrders.length, 1);
        assert.equal(buyOrders[0].quantity, 100, 'expected quantity to be lots * lot_size (100)');
    });

    it('15m Timeframe: ignores intra-bar forming ticks and executes ONLY on closed candle completion', async () => {
        resetStore({ balance: 100000, bought: {} });
        const details = strategyDetails({ timeframe: '15m' });

        // Initialized swing state
        let state = {
            isUp: false,
            prevHigh: { high: 105, low: 104 },
            prevLow: { high: 100, low: 99 },
        };

        const formingTick1 = { high: 106, low: 99, ltp: 106, isClosed: false };
        const formingTick2 = { high: 107, low: 98, ltp: 98, isClosed: false };
        const formingTick3 = { high: 108, low: 97, ltp: 108, isClosed: false };

        // 20 intra-bar ticks arrive during forming 15m candle
        for (let i = 0; i < 20; i++) {
            const tick = i % 2 === 0 ? formingTick1 : formingTick2;
            state = await strategy.executeStrategy(state, tick, SYMBOL, details);
        }

        assert.equal(store.orders.length, 0, 'must trigger ZERO trades on intra-bar ticks inside 15m candle');

        // Now 15m candle closes at 09:30:01 AM
        const closed15mCandle = { open: 100, high: 108, low: 97, close: 107, isClosed: true };
        const formingNextBarTick = { high: 107, low: 107, ltp: 107, isClosed: false };

        state = await strategy.executeStrategy(
            state,
            { ...formingNextBarTick, closedCandle: closed15mCandle },
            SYMBOL,
            details
        );

        assert.equal(state.isUp, true, 'must update trend to UP on 15m closed candle breakout');
        assert.equal(store.orders.length, 1, 'must trigger exactly 1 BUY order on 15m candle close');
        assert.equal(store.orders[0].transaction_type, 'BUY');
    });

    it('processes centralized multi-timeframe snapshot format and executes on closedCandle', async () => {
        const details = strategyDetails({ timeframe: '5m' });

        // Initial bar state to set swing points
        let state = await strategy.executeStrategy(
            null,
            candle({ high: 100, low: 95, ltp: 98 }),
            SYMBOL,
            details
        );

        // Snapshot with forming bar (closedCandle = null)
        const intraBarSnapshot = {
            symbol: SYMBOL,
            eventTimestamp: 1720236005000,
            snapshotVersion: 1,
            ltp: 102,
            timeframes: {
                '5m': {
                    open: 98,
                    high: 102,
                    low: 97,
                    close: 102,
                    volume: 50,
                    isClosed: false,
                    closedCandle: null,
                },
            },
        };

        state = await strategy.executeStrategy(state, intraBarSnapshot, SYMBOL, details);
        assert.equal(store.orders.length, 0, 'must not trade on intra-bar snapshot');

        // Snapshot with closedCandle on 5m rollover (breakout above 100)
        const rolloverSnapshot = {
            symbol: SYMBOL,
            eventTimestamp: 1720236305000,
            snapshotVersion: 2,
            ltp: 103,
            timeframes: {
                '5m': {
                    open: 103,
                    high: 103,
                    low: 103,
                    close: 103,
                    volume: 10,
                    isClosed: false,
                    closedCandle: {
                        open: 98,
                        high: 105,
                        low: 97,
                        close: 103,
                        volume: 500,
                        isClosed: true,
                    },
                },
            },
        };

        state = await strategy.executeStrategy(state, rolloverSnapshot, SYMBOL, details);
        assert.equal(state.isUp, true, 'must trigger UP trend on closedCandle breakout');
        assert.equal(store.orders.length, 1, 'must trigger exactly 1 BUY order');
        assert.equal(store.orders[0].transaction_type, 'BUY');
    });
});
