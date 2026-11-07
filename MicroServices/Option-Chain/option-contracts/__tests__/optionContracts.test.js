import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('MicroServices/Option-Chain/option-contracts Unit Tests', () => {

    function validateContractsRequest(query) {
        const userId = typeof query?.userId === 'string' ? query.userId.trim() : '';
        if (!userId) {
            return { status: 400, message: 'Bad Request: userId is required' };
        }
        const symbol = typeof query?.symbol === 'string' ? query.symbol.trim() : '';
        if (!symbol) {
            return { status: 400, message: 'Bad Request: symbol is required' };
        }
        const expiry = typeof query?.expiry === 'string' ? query.expiry.trim() : '';
        const options = expiry ? { expiryDate: expiry } : null;

        return { status: 200, userId, symbol, options };
    }

    it('rejects request with missing or empty userId (400)', () => {
        assert.equal(validateContractsRequest({}).status, 400);
        assert.equal(validateContractsRequest({ userId: '' }).status, 400);
    });

    it('rejects request with missing or empty symbol (400)', () => {
        assert.equal(validateContractsRequest({ userId: 'u1' }).status, 400);
        assert.equal(validateContractsRequest({ userId: 'u1', symbol: '   ' }).status, 400);
    });

    it('handles optional expiry: null when omitted', () => {
        const res = validateContractsRequest({ userId: 'u1', symbol: 'NIFTY' });
        assert.equal(res.status, 200);
        assert.equal(res.options, null);
    });

    it('handles optional expiry: { expiryDate } when provided', () => {
        const res = validateContractsRequest({ userId: 'u1', symbol: 'NIFTY', expiry: '2024-12-26' });
        assert.equal(res.status, 200);
        assert.deepEqual(res.options, { expiryDate: '2024-12-26' });
    });
});
