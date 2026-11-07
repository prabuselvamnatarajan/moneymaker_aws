import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('MicroServices/Option-Chain/put-call-option-chain Unit Tests', () => {

    function validateChainRequest(query) {
        const userId = typeof query?.userId === 'string' ? query.userId.trim() : '';
        if (!userId) {
            return { status: 400, message: 'Bad Request: userId is required' };
        }
        const symbol = typeof query?.symbol === 'string' ? query.symbol.trim() : '';
        if (!symbol) {
            return { status: 400, message: 'Bad Request: symbol is required' };
        }
        const expiry = typeof query?.expiry === 'string' ? query.expiry.trim() : '';
        if (!expiry) {
            return { status: 400, message: 'Bad Request: expiry is required' };
        }

        return { status: 200, userId, symbol, expiry };
    }

    function extractUpstoxErrorMessage(error) {
        try {
            const text = error?.response?.text || error?.text;
            if (text) {
                const parsed = JSON.parse(text);
                const first = parsed?.errors?.[0];
                if (first?.message) return first.message;
            }
        } catch {
            // ignore parse errors
        }
        return error?.message || 'Upstox API request failed';
    }

    it('rejects request with missing userId (400)', () => {
        assert.equal(validateChainRequest({ symbol: 'NIFTY', expiry: '2024-12-26' }).status, 400);
    });

    it('rejects request with missing symbol (400)', () => {
        assert.equal(validateChainRequest({ userId: 'u1', expiry: '2024-12-26' }).status, 400);
    });

    it('rejects request with missing expiry (400)', () => {
        assert.equal(validateChainRequest({ userId: 'u1', symbol: 'NIFTY' }).status, 400);
    });

    it('accepts valid chain request with trimmed fields', () => {
        const res = validateChainRequest({ userId: ' u1 ', symbol: ' NIFTY ', expiry: ' 2024-12-26 ' });
        assert.equal(res.status, 200);
        assert.equal(res.userId, 'u1');
        assert.equal(res.symbol, 'NIFTY');
        assert.equal(res.expiry, '2024-12-26');
    });

    it('extracts Upstox error message when request fails', () => {
        const err = { response: { text: JSON.stringify({ errors: [{ message: 'Expiry date not found' }] }) } };
        assert.equal(extractUpstoxErrorMessage(err), 'Expiry date not found');
    });
});
