import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveExecutionMode,
    buildBrokerOrderPayload,
    buildTradePayload,
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

    it('TC-PO-013: falls back to resolved LTP for MARKET order when recording trade in BackTestApp', () => {
        const body = {
            transaction_type: 'BUY',
            price: 0,
            quantity: 5,
            strategy_details: { user_id: 'user_1', account_id: 'acc_1' },
        };
        const tradePayload = buildTradePayload(body, 152.35);
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
});
