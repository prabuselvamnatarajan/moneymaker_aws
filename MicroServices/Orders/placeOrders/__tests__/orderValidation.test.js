import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isMissingRequiredOrderFields } from '../orderValidation.js';

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
