import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    computeBuyQuantity,
    sanitizeTag,
    buildClientOrderId,
    computeOrderPayload,
} from '../orders.js';

describe('shared/strategy orders - Order Payload Math & Sizing Rules', () => {

    it('computes BUY quantity using fixed lots and lot size when use_full_amount is false', () => {
        const qty = computeBuyQuantity({
            use_full_amount: false,
            lot_size: 25,
            no_of_lots: 3,
        });
        assert.equal(qty, 75);
    });

    it('computes BUY quantity with use_full_amount and no lot size', () => {
        const qty = computeBuyQuantity({
            use_full_amount: true,
            balance: 100000,
            ltp: 2500,
            lot_size: null,
            commission_rate: 0,
        });
        assert.equal(qty, 40); // 100000 / 2500 = 40
    });

    it('computes BUY quantity with use_full_amount adhering to lot size multiplier', () => {
        // Balance 100,000, LTP 250, lot size 50.
        // Cost per lot = 250 * 50 = 12,500.
        // Affordable lots = floor(100,000 / 12,500) = 8 lots -> 400 qty.
        const qty = computeBuyQuantity({
            use_full_amount: true,
            balance: 100000,
            ltp: 250,
            lot_size: 50,
        });
        assert.equal(qty, 400);
        assert.equal(qty % 50, 0, 'quantity must be a multiple of lot size');
    });

    it('deducts flat commission before calculating max affordable quantity', () => {
        // Balance 1000, flat commission 20 -> available 980. LTP 100 -> 9 units.
        const qty = computeBuyQuantity({
            use_full_amount: true,
            balance: 1000,
            ltp: 100,
            commission_type: 'FLAT',
            commission_rate: 20,
        });
        assert.equal(qty, 9);
    });

    it('deducts percentage commission before calculating max affordable quantity', () => {
        // Balance 1050, 5% commission -> available 1050 / 1.05 = 1000. LTP 100 -> 10 units.
        const qty = computeBuyQuantity({
            use_full_amount: true,
            balance: 1050,
            ltp: 100,
            commission_type: 'PERCENTAGE',
            commission_rate: 5,
        });
        assert.equal(qty, 10);
    });

    it('returns 0 quantity when balance is 0 or less than single unit price', () => {
        const qty = computeBuyQuantity({
            use_full_amount: true,
            balance: 50,
            ltp: 100,
        });
        assert.equal(qty, 0);
    });

    it('sanitizes tag with special characters to prevent invalid order identifiers', () => {
        assert.equal(sanitizeTag('NIFTY:OPT#1'), 'NIFTY_OPT_1');
        assert.equal(sanitizeTag('SYM/TEST@123'), 'SYM_TEST_123');
        assert.equal(sanitizeTag(null), 'symbol');
        assert.equal(sanitizeTag(''), 'symbol');
    });

    it('builds unique deterministic client_order_id adhering to production format', () => {
        const ts = 1700000000000;
        const id1 = buildClientOrderId('dep_1', 'tagA', 'BUY', ts);
        const id2 = buildClientOrderId('dep_2', 'tagA', 'BUY', ts);
        assert.equal(id1, 'dep_1_tagA_BUY_1700000000000');
        assert.notEqual(id1, id2);
    });

    it('computeOrderPayload builds full order payload with client_order_id and sanitized tag', async () => {
        const payload = await computeOrderPayload({
            strategyDetails: {
                account_id: 'acc_1',
                deployment_id: 'dep_99',
                quantity: 10,
                lot_size: 10,
                strategy_mode: 'LIVE',
            },
            transactionType: 'BUY',
            price: 500,
            tag: 'TEST:SYMBOL',
            timestamp: 1700000000000,
        });

        assert.equal(payload.quantity, 10);
        assert.equal(payload.price, 500);
        assert.equal(payload.tag, 'TEST_SYMBOL');
        assert.equal(payload.transaction_type, 'BUY');
        assert.equal(payload.client_order_id, 'dep_99_TEST_SYMBOL_BUY_1700000000000');
    });
});
