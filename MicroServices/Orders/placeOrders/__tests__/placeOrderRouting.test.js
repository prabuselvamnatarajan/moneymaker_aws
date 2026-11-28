import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveExecutionMode,
    buildBrokerOrderPayload,
    buildTradePayload,
    getClientOrderId,
    recordTradeInLedger,
} from '../dependency.js';

describe('placeOrders Routing, Payload Transformation & Client Order ID Tests (Real Codebase)', () => {

    const liveUpstox = { strategy_mode: 'LIVE', account_type: 'LIVE', is_internal_broker: false, external_broker_id: 'upstox' };

    it('TC-PO-007: routes to the external broker only for a LIVE deployment on a LIVE Upstox account', () => {
        const mode = resolveExecutionMode(liveUpstox);
        assert.equal(mode.mode, 'LIVE');
        assert.equal(mode.shouldCallExternalBroker, true);
        assert.equal(mode.isBacktest, false);
    });

    it('TC-PO-008: PAPER orders are booked internally', () => {
        const mode = resolveExecutionMode({ strategy_mode: 'PAPER', account_type: 'PAPER', is_internal_broker: true });
        assert.equal(mode.shouldCallExternalBroker, false);
        assert.equal(mode.isBacktest, false);
    });

    it('TC-PO-009: LIVE mode on an internal-broker account is refused, not booked', () => {
        assert.throws(
            () => resolveExecutionMode({ ...liveUpstox, is_internal_broker: true }),
            (err) => err.statusCode === 409 && /not linked to an external broker/.test(err.message)
        );
    });

    it('TC-PO-025: PAPER with isTest:false never reaches the broker (review #1 regression)', () => {
        const mode = resolveExecutionMode({
            strategy_mode: 'PAPER', isTest: false, account_type: 'LIVE', is_internal_broker: false, external_broker_id: 'upstox',
        });
        assert.equal(mode.shouldCallExternalBroker, false);
    });

    it('TC-PO-026: isTest:false without a LIVE strategy_mode is not treated as live', () => {
        assert.throws(() => resolveExecutionMode({ isTest: false, is_internal_broker: false }), (err) => err.statusCode === 400);
    });

    it('TC-PO-027: a missing or unknown strategy_mode is rejected with 400', () => {
        assert.throws(() => resolveExecutionMode({}), (err) => err.statusCode === 400);
        assert.throws(() => resolveExecutionMode(undefined), (err) => err.statusCode === 400);
        assert.throws(() => resolveExecutionMode({ strategy_mode: 'live' }), (err) => err.statusCode === 400);
    });

    it('TC-PO-028: LIVE mode on a non-LIVE account is refused', () => {
        for (const account_type of ['PAPER', 'SIMULATION', undefined]) {
            assert.throws(
                () => resolveExecutionMode({ ...liveUpstox, account_type }),
                (err) => err.statusCode === 409 && /account type/.test(err.message)
            );
        }
    });

    it('TC-PO-029: LIVE mode with a missing is_internal_broker flag is refused (fail safe)', () => {
        const { is_internal_broker, ...rest } = liveUpstox;
        assert.throws(() => resolveExecutionMode(rest), (err) => err.statusCode === 409);
    });

    it('TC-PO-030: LIVE mode with a broker other than Upstox is refused until it is supported', () => {
        for (const external_broker_id of ['zerodha', 'groww', null, undefined]) {
            assert.throws(
                () => resolveExecutionMode({ ...liveUpstox, external_broker_id }),
                (err) => err.statusCode === 409 && /not supported yet/.test(err.message)
            );
        }
    });

    it('TC-PO-031: BACKTEST orders are booked internally and flagged as backtest', () => {
        const mode = resolveExecutionMode({ strategy_mode: 'BACKTEST', account_type: 'SIMULATION', is_internal_broker: true });
        assert.equal(mode.shouldCallExternalBroker, false);
        assert.equal(mode.isBacktest, true);
    });

    const strategyOrder = {
        quantity: 75,
        product: 'D',
        validity: 'DAY',
        price: 250.5,
        ltp: 250.5,
        tag: 'NIFTY24DEC24000CE',
        instrument_token: 'NSE_FO|43919',
        order_type: 'MARKET',
        transaction_type: 'BUY',
        disclosed_quantity: 0,
        trigger_price: 0,
        is_amo: false,
        slice: true,
        client_order_id: 'dep1_NIFTY_BUY_1700000000000',
        strategy_details: { user_id: 'u1', account_id: 'a1', deployment_id: 'dep1', strategy_mode: 'LIVE' },
    };

    it('TC-PO-011: buildBrokerOrderPayload zeroes price for MARKET orders', () => {
        const payload = buildBrokerOrderPayload(strategyOrder);
        assert.equal(payload.price, 0);
        assert.equal(payload.quantity, 75);
    });

    it('TC-PO-012: buildBrokerOrderPayload preserves price for LIMIT orders', () => {
        const payload = buildBrokerOrderPayload({ ...strategyOrder, order_type: 'LIMIT', price: 245.0 });
        assert.equal(payload.price, 245.0);
    });

    it('TC-PO-032: the Upstox payload holds exactly the documented V3 fields', () => {
        const payload = buildBrokerOrderPayload(strategyOrder);
        assert.deepEqual(Object.keys(payload).sort(), [
            'disclosed_quantity', 'instrument_token', 'is_amo', 'order_type', 'price', 'product',
            'quantity', 'slice', 'tag', 'transaction_type', 'trigger_price', 'validity',
        ]);
        assert.deepEqual(payload, {
            quantity: 75, product: 'D', validity: 'DAY', price: 0, instrument_token: 'NSE_FO|43919',
            order_type: 'MARKET', transaction_type: 'BUY', disclosed_quantity: 0, trigger_price: 0,
            is_amo: false, slice: true, tag: 'NIFTY24DEC24000CE',
        });
    });

    it('TC-PO-033: internal fields never reach Upstox', () => {
        const payload = buildBrokerOrderPayload({ ...strategyOrder, Symbol_Name: 'x', latency: {}, execution_time: 'now' });
        for (const key of ['strategy_details', 'client_order_id', 'ltp', 'Symbol_Name', 'latency', 'execution_time', 'market_protection']) {
            assert.equal(key in payload, false, `${key} must not be sent`);
        }
    });

    it('TC-PO-034: coerces string values to the types Upstox expects', () => {
        const payload = buildBrokerOrderPayload({
            ...strategyOrder, quantity: '75', order_type: 'limit', price: '245.5', product: 'i', validity: 'ioc',
            transaction_type: 'sell', disclosed_quantity: '10', is_amo: 'true', slice: 'false',
        });
        assert.equal(payload.quantity, 75);
        assert.equal(payload.price, 245.5);
        assert.equal(payload.order_type, 'LIMIT');
        assert.equal(payload.product, 'I');
        assert.equal(payload.validity, 'IOC');
        assert.equal(payload.transaction_type, 'SELL');
        assert.equal(payload.disclosed_quantity, 10);
        assert.equal(payload.is_amo, true);
        assert.equal(payload.slice, false);
    });

    it('TC-PO-035: rejects values outside the documented enums with 400', () => {
        const cases = [
            { order_type: 'STOP' }, { transaction_type: 'SHORT' }, { product: 'CNC' }, { validity: 'GTC' },
            { order_type: undefined }, { product: undefined },
        ];
        for (const override of cases) {
            assert.throws(() => buildBrokerOrderPayload({ ...strategyOrder, ...override }), (err) => err.statusCode === 400, JSON.stringify(override));
        }
    });

    it('TC-PO-036: rejects bad quantity, instrument and disclosed quantity with 400', () => {
        const cases = [
            { quantity: 0 }, { quantity: -5 }, { quantity: 1.5 }, { quantity: 'abc' },
            { instrument_token: '' }, { instrument_token: undefined },
            { disclosed_quantity: -1 }, { disclosed_quantity: 100 }, { disclosed_quantity: 2.5 },
        ];
        for (const override of cases) {
            assert.throws(() => buildBrokerOrderPayload({ ...strategyOrder, ...override }), (err) => err.statusCode === 400, JSON.stringify(override));
        }
    });

    it('TC-PO-037: LIMIT/SL need a price and SL/SL-M need a trigger_price', () => {
        assert.throws(() => buildBrokerOrderPayload({ ...strategyOrder, order_type: 'LIMIT', price: 0 }), /positive price/);
        assert.throws(() => buildBrokerOrderPayload({ ...strategyOrder, order_type: 'SL', price: 100, trigger_price: 0 }), /trigger_price/);
        assert.throws(() => buildBrokerOrderPayload({ ...strategyOrder, order_type: 'SL-M', trigger_price: undefined }), /trigger_price/);
        const slm = buildBrokerOrderPayload({ ...strategyOrder, order_type: 'SL-M', price: 99, trigger_price: 98 });
        assert.equal(slm.price, 0);
        assert.equal(slm.trigger_price, 98);
        const market = buildBrokerOrderPayload({ ...strategyOrder, trigger_price: 50 });
        assert.equal(market.trigger_price, 0);
    });

    it('TC-PO-038: an empty tag is omitted', () => {
        assert.equal('tag' in buildBrokerOrderPayload({ ...strategyOrder, tag: '' }), false);
        assert.equal('tag' in buildBrokerOrderPayload({ ...strategyOrder, tag: undefined }), false);
    });

    it('TC-PO-013: falls back to the tick LTP for MARKET order when recording trade in BackTestApp', () => {
        const body = {
            transaction_type: 'BUY',
            price: 0,
            ltp: 152.35,
            quantity: 5,
            strategy_details: { user_id: 'user_1', account_id: 'acc_1' },
        };
        const tradePayload = buildTradePayload(body);
        assert.equal(tradePayload.price, 152.35);
        assert.equal(tradePayload.type_of_order, 'BUY');
        assert.equal(tradePayload.quantity, 5);
    });

    it('TC-PO-014: forwards client_order_id from root body or nested strategy_details', () => {
        const bodyFromRoot = {
            transaction_type: 'BUY',
            price: 100,
            quantity: 1,
            client_order_id: 'ord-root-123',
            strategy_details: {},
        };
        assert.equal(buildTradePayload(bodyFromRoot).client_order_id, 'ord-root-123');

        const bodyFromNested = {
            transaction_type: 'BUY',
            price: 100,
            quantity: 1,
            strategy_details: { client_order_id: 'ord-nested-456' },
        };
        assert.equal(buildTradePayload(bodyFromNested).client_order_id, 'ord-nested-456');
    });

    it('TC-PO-016: getClientOrderId reads the root id first, then strategy_details, never invents one', () => {
        assert.equal(getClientOrderId({ client_order_id: 'root', strategy_details: { client_order_id: 'nested' } }), 'root');
        assert.equal(getClientOrderId({ strategy_details: { client_order_id: 'nested' } }), 'nested');
        assert.equal(getClientOrderId({ strategy_details: {} }), null);
        assert.equal(getClientOrderId({}), null);
    });

    describe('recordTradeInLedger', () => {
        const body = { transaction_type: 'BUY', price: 100, quantity: 1, client_order_id: 'c1', strategy_details: { user_id: 'u1' } };
        const realFetch = globalThis.fetch;
        const respond = (status, data) => ({ ok: status < 400, status, json: async () => data });

        it('TC-PO-018: retries a 5xx and returns the later success', async (t) => {
            let calls = 0;
            globalThis.fetch = async () => (++calls === 1 ? respond(503, { message: 'busy' }) : respond(200, { data: { closing_balance: 900 } }));
            t.after(() => { globalThis.fetch = realFetch; });
            const res = await recordTradeInLedger(body);
            assert.equal(calls, 2);
            assert.equal(res.data.closing_balance, 900);
        });

        it('TC-PO-019: does not retry a 4xx', async (t) => {
            let calls = 0;
            globalThis.fetch = async () => { calls++; return respond(400, { message: 'bad' }); };
            t.after(() => { globalThis.fetch = realFetch; });
            await assert.rejects(recordTradeInLedger(body), /bad/);
            assert.equal(calls, 1);
        });
    });
});
