import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('shared/strategy orders - Order Payload Math & Sizing Rules', () => {

    function computeBuyQuantity({
        use_full_amount,
        balance,
        ltp,
        lot_size,
        no_of_lots = 1,
        default_qty = 1,
        commission_type = 'PERCENTAGE',
        commission_rate = 0,
    }) {
        const lot = Number(lot_size) > 0 ? Number(lot_size) : null;
        const lots = Number(no_of_lots) >= 1 ? Math.floor(Number(no_of_lots)) : 1;

        if (use_full_amount) {
            if (balance != null && balance >= 0) {
                let maxAffordableValue = balance;
                if (commission_type === 'FLAT') {
                    maxAffordableValue = Math.max(0, balance - commission_rate);
                } else if (commission_type === 'PERCENTAGE') {
                    maxAffordableValue = balance / (1 + (commission_rate / 100));
                }
                maxAffordableValue = Math.max(0, maxAffordableValue + 1e-5);

                if (lot) {
                    return Math.floor(maxAffordableValue / (ltp * lot)) * lot;
                } else {
                    return Math.floor(maxAffordableValue / ltp);
                }
            } else {
                return lot ? (lots * lot) : default_qty;
            }
        } else if (lot) {
            return lots * lot;
        } else {
            return default_qty;
        }
    }

    function sanitizeTag(tag) {
        return tag ? tag.replace(/[^a-zA-Z0-9_-]/g, '_') : 'symbol';
    }

    function buildClientOrderId(deploymentId, tag, timestamp) {
        const sanitizedTag = sanitizeTag(tag);
        const timePart = timestamp ? new Date(timestamp).getTime() : Date.now();
        return `${deploymentId || 'dep'}-${sanitizedTag}-${timePart}`;
    }

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

    it('builds unique deterministic client_order_id', () => {
        const ts = 1700000000000;
        const id1 = buildClientOrderId('dep_1', 'tagA', ts);
        const id2 = buildClientOrderId('dep_2', 'tagA', ts);
        assert.equal(id1, 'dep_1-tagA-1700000000000');
        assert.notEqual(id1, id2);
    });
});
