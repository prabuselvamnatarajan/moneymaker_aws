import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isMissingRequiredOrderFields, isMissingClientOrderId } from '../orderValidation.js';

describe('isMissingRequiredOrderFields', () => {
    const valid = {
        instrument_token: 'NSE_EQ|INE123',
        price: 100,
        quantity: 1,
        transaction_type: 'BUY',
        strategy_details: { user_id: 'user-1' },
    };

    it('returns false when all required fields are present', () => {
        assert.equal(isMissingRequiredOrderFields(valid), false);
    });

    it('returns true when instrument_token is missing', () => {
        const { instrument_token, ...rest } = valid;
        assert.equal(isMissingRequiredOrderFields(rest), true);
    });

    it('returns true when price is undefined but allows zero', () => {
        assert.equal(isMissingRequiredOrderFields({ ...valid, price: undefined }), true);
        assert.equal(isMissingRequiredOrderFields({ ...valid, price: 0 }), false);
    });

    it('returns true when strategy_details.user_id is missing', () => {
        assert.equal(isMissingRequiredOrderFields({ ...valid, strategy_details: {} }), true);
    });

    it('returns true for an empty body', () => {
        assert.equal(isMissingRequiredOrderFields(), true);
        assert.equal(isMissingRequiredOrderFields({}), true);
    });
});

describe('isMissingClientOrderId', () => {
    it('TC-PO-039: accepts an id on the body or in strategy_details', () => {
        assert.equal(isMissingClientOrderId({ client_order_id: 'c1', strategy_details: {} }), false);
        assert.equal(isMissingClientOrderId({ strategy_details: { client_order_id: 'c1' } }), false);
    });

    it('TC-PO-040: rejects a missing, empty or non-string id (no server-side fallback)', () => {
        assert.equal(isMissingClientOrderId({ strategy_details: {} }), true);
        assert.equal(isMissingClientOrderId({}), true);
        assert.equal(isMissingClientOrderId({ client_order_id: '   ' }), true);
        assert.equal(isMissingClientOrderId({ client_order_id: 123 }), true);
    });
});
