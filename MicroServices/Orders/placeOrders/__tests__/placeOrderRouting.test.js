import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveExecutionMode,
    buildBrokerOrderPayload,
    buildTradePayload,
    ensureClientOrderId,
    recordTradeInLedger,
    resolveLedgerMode,
} from '../dependency.js';

describe('placeOrders Routing, Payload Transformation & Client Order ID Tests (Real Codebase)', () => {

    it('TC-PO-007: routes to external broker when strategy_mode is LIVE and is_internal_broker is false', () => {
        const mode = resolveExecutionMode({ strategy_mode: 'LIVE', is_internal_broker: false });
        assert.equal(mode.isLive, true);
        assert.equal(mode.isInternalBroker, false);
        assert.equal(mode.shouldCallExternalBroker, true);
    });

    it('TC-PO-008: routes to paper simulation when strategy_mode is PAPER', () => {
        const mode = resolveExecutionMode({ strategy_mode: 'PAPER' });
        assert.equal(mode.isLive, false);
        assert.equal(mode.shouldCallExternalBroker, false);
    });

    it('TC-PO-009: skips external broker when is_internal_broker is true even in LIVE mode', () => {
        const mode = resolveExecutionMode({ strategy_mode: 'LIVE', is_internal_broker: true });
        assert.equal(mode.isLive, true);
        assert.equal(mode.isInternalBroker, true);
        assert.equal(mode.shouldCallExternalBroker, false);
    });

    it('TC-PO-011: buildBrokerOrderPayload zeroes price for MARKET orders', () => {
        const marketOrder = { order_type: 'MARKET', price: 250.5, quantity: 10 };
        const payload = buildBrokerOrderPayload(marketOrder);
        assert.equal(payload.price, 0);
        assert.equal(payload.quantity, 10);
    });

    it('TC-PO-012: buildBrokerOrderPayload preserves price for LIMIT orders', () => {
        const limitOrder = { order_type: 'LIMIT', price: 245.0, quantity: 10 };
        const payload = buildBrokerOrderPayload(limitOrder);
        assert.equal(payload.price, 245.0);
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

    it('TC-PO-015: buildBrokerOrderPayload does not send the tick ltp to the broker', () => {
        const payload = buildBrokerOrderPayload({ order_type: 'MARKET', price: 250.5, ltp: 250.5, quantity: 1 });
        assert.equal('ltp' in payload, false);
    });

    it('TC-PO-016: ensureClientOrderId keeps an existing id and generates one when missing', () => {
        const withId = ensureClientOrderId({ client_order_id: 'keep-me', strategy_details: {} });
        assert.equal(withId.client_order_id, 'keep-me');
        const nested = ensureClientOrderId({ strategy_details: { client_order_id: 'nested' } });
        assert.equal(nested.client_order_id, undefined);
        const generated = ensureClientOrderId({ tag: 'SBIN', transaction_type: 'BUY', strategy_details: { deployment_id: 'dep1' } });
        assert.match(generated.client_order_id, /^dep1_SBIN_BUY_\d+_[a-z0-9]+$/);
    });

    it('TC-PO-017: resolveLedgerMode defaults to sequential and honours parallel', () => {
        const prev = process.env.ORDER_LEDGER_MODE;
        delete process.env.ORDER_LEDGER_MODE;
        assert.equal(resolveLedgerMode(), 'sequential');
        process.env.ORDER_LEDGER_MODE = 'PARALLEL';
        assert.equal(resolveLedgerMode(), 'parallel');
        if (prev === undefined) delete process.env.ORDER_LEDGER_MODE; else process.env.ORDER_LEDGER_MODE = prev;
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
