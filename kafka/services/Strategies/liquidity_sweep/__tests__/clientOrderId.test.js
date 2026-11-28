import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LiquiditySweepStrategy } from '../LiquiditySweep.js';
import { closePosition } from '../modules/tradeManagement.js';
import { sentOrders } from './mocks/axios.js';
import { resetStore } from './mocks/account_utils.js';

const SYMBOL = 'NSE_EQ|INE002A01018';
const TICK_TS = Date.parse('2026-11-28T09:30:00.000Z');

function details() {
    return {
        deployment_id: 'dep-sweep-1',
        account_id: 'acc-1',
        instrument_token: SYMBOL,
        strategy_mode: 'PAPER',
        quantity: 1,
    };
}

function longPosition() {
    return {
        direction: 'long',
        entry: 100,
        stop: 95,
        target: 110,
        target1: 105,
        riskDistance: 5,
        qty: 10,
        remainingQty: 10,
        openedAt: TICK_TS - 60_000,
        breakevenMoved: false,
        partialTaken: false,
        trailStop: null,
    };
}

describe('client_order_id per order (TC-COID-*)', () => {
    beforeEach(() => {
        process.env.PLACEORDER_API = 'http://localhost/placeorder';
        process.env.NODE_ENV = 'test';
        resetStore({ balance: 100000, bought: { [`dep-sweep-1:${SYMBOL}`]: 10 } });
        sentOrders.length = 0;
    });

    it('TC-COID-001: partial exit and final exit in the same tick get different ids', async () => {
        const strategy = new LiquiditySweepStrategy();
        const sd = details();
        strategy.symbol = SYMBOL;
        strategy.strategyDetails = sd;
        const position = longPosition();

        // A gap tick past both target1 and target: two SELLs at the same tick time.
        assert.equal(await closePosition(strategy, position, 112, SYMBOL, sd, 'partial_target1', 5, TICK_TS), true);
        assert.equal(await closePosition(strategy, position, 112, SYMBOL, sd, 'target', 5, TICK_TS), true);

        const sells = sentOrders.filter((o) => o.transaction_type === 'SELL');
        assert.equal(sells.length, 2);
        assert.notEqual(sells[0].client_order_id, sells[1].client_order_id);
        assert.match(sells[0].client_order_id, /_SELL_\d+_1$/);
        assert.match(sells[1].client_order_id, /_SELL_\d+_2$/);
    });

    it('TC-COID-002: re-processing the same tick rebuilds the same ids (ledger stays idempotent)', async () => {
        const run = async () => {
            const strategy = new LiquiditySweepStrategy();
            const sd = details();
            strategy.symbol = SYMBOL;
            strategy.strategyDetails = sd;
            const position = longPosition();
            await closePosition(strategy, position, 112, SYMBOL, sd, 'partial_target1', 5, TICK_TS);
            await closePosition(strategy, position, 112, SYMBOL, sd, 'target', 5, TICK_TS);
        };
        await run();
        const first = sentOrders.map((o) => o.client_order_id);
        sentOrders.length = 0;
        resetStore({ balance: 100000, bought: { [`dep-sweep-1:${SYMBOL}`]: 10 } });
        await run();
        assert.deepEqual(sentOrders.map((o) => o.client_order_id), first);
    });

    it('TC-COID-003: the sequence restarts on the next tick', async () => {
        const strategy = new LiquiditySweepStrategy();
        strategy.symbol = SYMBOL;
        strategy.strategyDetails = details();
        await strategy.triggerOrder('BUY', { price: 100, quantity: 1, tag: SYMBOL, timestamp: TICK_TS });
        // A new tick arrives with a new strategyDetails object.
        strategy.strategyDetails = details();
        await strategy.triggerOrder('BUY', { price: 101, quantity: 1, tag: SYMBOL, timestamp: TICK_TS + 1000 });
        assert.match(sentOrders[0].client_order_id, /_BUY_\d+_1$/);
        assert.match(sentOrders[1].client_order_id, /_BUY_\d+_1$/);
        assert.notEqual(sentOrders[0].client_order_id, sentOrders[1].client_order_id);
    });

    it('TC-COID-004: an HTTP retry resends the same id', async () => {
        const strategy = new LiquiditySweepStrategy();
        strategy.symbol = SYMBOL;
        strategy.strategyDetails = details();
        const order = await strategy.computeOrderPayload('BUY', { price: 100, quantity: 1, tag: SYMBOL, timestamp: TICK_TS });
        await strategy.placeOrder(order);
        await strategy.placeOrder(order);
        assert.equal(sentOrders.length, 2);
        assert.equal(sentOrders[0].client_order_id, sentOrders[1].client_order_id);
    });
});
