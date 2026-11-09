import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    validateOptionChainRequest,
    extractUpstoxErrorMessage,
    handleApiCallbackError,
} from '../requestHelper.js';

describe('MicroServices/Option-Chain/put-call-option-chain requestHelper (Real Codebase)', () => {
    it('rejects request with missing or empty userId (400)', () => {
        const r1 = validateOptionChainRequest({ symbol: 'NIFTY', expiry: '2024-12-26' });
        assert.equal(r1.status, 400);
        assert.ok(r1.error.includes('userId is required'));

        const r2 = validateOptionChainRequest({ userId: '   ', symbol: 'NIFTY', expiry: '2024-12-26' });
        assert.equal(r2.status, 400);
        assert.ok(r2.error.includes('userId is required'));
    });

    it('rejects request with missing or empty symbol (400)', () => {
        const r1 = validateOptionChainRequest({ userId: 'u1', expiry: '2024-12-26' });
        assert.equal(r1.status, 400);
        assert.ok(r1.error.includes('symbol is required'));

        const r2 = validateOptionChainRequest({ userId: 'u1', symbol: '   ', expiry: '2024-12-26' });
        assert.equal(r2.status, 400);
        assert.ok(r2.error.includes('symbol is required'));
    });

    it('rejects request with missing or empty expiry (400)', () => {
        const r1 = validateOptionChainRequest({ userId: 'u1', symbol: 'NIFTY' });
        assert.equal(r1.status, 400);
        assert.ok(r1.error.includes('expiry is required'));

        const r2 = validateOptionChainRequest({ userId: 'u1', symbol: 'NIFTY', expiry: '   ' });
        assert.equal(r2.status, 400);
        assert.ok(r2.error.includes('expiry is required'));
    });

    it('accepts valid chain request with trimmed fields', () => {
        const res = validateOptionChainRequest({ userId: ' u1 ', symbol: ' NIFTY ', expiry: ' 2024-12-26 ' });
        assert.equal(res.status, 200);
        assert.equal(res.userId, 'u1');
        assert.equal(res.symbol, 'NIFTY');
        assert.equal(res.expiry, '2024-12-26');
    });

    it('extracts Upstox error message when request fails', () => {
        const err = { response: { text: JSON.stringify({ errors: [{ message: 'Expiry date not found' }] }) } };
        assert.equal(extractUpstoxErrorMessage(err), 'Expiry date not found');

        const generic = new Error('Socket closed');
        assert.equal(extractUpstoxErrorMessage(generic), 'Socket closed');

        assert.equal(extractUpstoxErrorMessage(null), 'Upstox API request failed');
    });

    it('handles callback errors appropriately (401 vs 500)', () => {
        const authErr = handleApiCallbackError({ status: 403 });
        assert.equal(authErr.statusCode, 401);
        assert.equal(authErr.invalidateToken, true);

        const serverErr = handleApiCallbackError({ status: 502, message: 'Bad Gateway' });
        assert.equal(serverErr.statusCode, 500);
        assert.equal(serverErr.invalidateToken, false);
    });
});
