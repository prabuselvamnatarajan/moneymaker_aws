import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    validateContractsRequest,
    extractUpstoxErrorMessage,
    handleApiCallbackError,
} from '../requestHelper.js';

describe('MicroServices/Option-Chain/option-contracts requestHelper (Real Codebase)', () => {
    it('rejects request with missing or empty userId (400)', () => {
        const r1 = validateContractsRequest({});
        assert.equal(r1.status, 400);
        assert.ok(r1.error.includes('userId is required'));

        const r2 = validateContractsRequest({ userId: '   ' });
        assert.equal(r2.status, 400);
        assert.ok(r2.error.includes('userId is required'));
    });

    it('rejects request with missing or empty symbol (400)', () => {
        const r1 = validateContractsRequest({ userId: 'u1' });
        assert.equal(r1.status, 400);
        assert.ok(r1.error.includes('symbol is required'));

        const r2 = validateContractsRequest({ userId: 'u1', symbol: '   ' });
        assert.equal(r2.status, 400);
        assert.ok(r2.error.includes('symbol is required'));
    });

    it('handles optional expiry: null when omitted', () => {
        const res = validateContractsRequest({ userId: 'u1', symbol: 'NIFTY' });
        assert.equal(res.status, 200);
        assert.equal(res.userId, 'u1');
        assert.equal(res.symbol, 'NIFTY');
        assert.equal(res.options, null);
    });

    it('handles optional expiry: { expiryDate } when provided', () => {
        const res = validateContractsRequest({ userId: 'u1', symbol: 'NIFTY', expiry: '2024-12-26' });
        assert.equal(res.status, 200);
        assert.equal(res.userId, 'u1');
        assert.equal(res.symbol, 'NIFTY');
        assert.deepEqual(res.options, { expiryDate: '2024-12-26' });
    });

    it('extractUpstoxErrorMessage parses nested json or falls back gracefully', () => {
        const jsonError = {
            response: {
                text: JSON.stringify({ errors: [{ message: 'Option symbol not found' }] }),
            },
        };
        assert.equal(extractUpstoxErrorMessage(jsonError), 'Option symbol not found');

        const genericError = new Error('Network timeout');
        assert.equal(extractUpstoxErrorMessage(genericError), 'Network timeout');

        assert.equal(extractUpstoxErrorMessage(null), 'Upstox API request failed');
    });

    it('handleApiCallbackError handles 401/403 and server errors', () => {
        const authErr = { status: 401 };
        const authRes = handleApiCallbackError(authErr);
        assert.equal(authRes.statusCode, 401);
        assert.equal(authRes.invalidateToken, true);
        assert.ok(authRes.body.includes('re-authenticate via Brokers page'));

        const serverErr = { status: 500, message: 'Upstox upstream down' };
        const serverRes = handleApiCallbackError(serverErr);
        assert.equal(serverRes.statusCode, 500);
        assert.equal(serverRes.invalidateToken, false);
        assert.ok(serverRes.body.includes('Upstox upstream down'));
    });
});
