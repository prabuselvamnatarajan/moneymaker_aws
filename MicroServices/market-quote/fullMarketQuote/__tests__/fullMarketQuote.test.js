import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('MicroServices/market-quote/fullMarketQuote Unit Tests', () => {

    function validateFullQuoteRequest(query) {
        const userId = typeof query?.userId === 'string' ? query.userId.trim() : '';
        if (!userId) {
            return { status: 400, message: 'Bad Request: userId is required' };
        }
        const symbol = typeof query?.symbol === 'string' ? query.symbol.trim() : '';
        if (!symbol) {
            return { status: 400, message: 'Bad Request: symbol is required' };
        }

        return { status: 200, userId, symbol, apiVersion: '2.0' };
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

    it('rejects request with missing or empty userId (400)', () => {
        assert.equal(validateFullQuoteRequest({}).status, 400);
        assert.equal(validateFullQuoteRequest({ userId: '  ' }).status, 400);
    });

    it('rejects request with missing or empty symbol (400)', () => {
        assert.equal(validateFullQuoteRequest({ userId: 'u1' }).status, 400);
        assert.equal(validateFullQuoteRequest({ userId: 'u1', symbol: '' }).status, 400);
    });

    it('validates request successfully and enforces apiVersion 2.0', () => {
        const res = validateFullQuoteRequest({ userId: 'u1', symbol: 'NSE_EQ|INE002A01018' });
        assert.equal(res.status, 200);
        assert.equal(res.userId, 'u1');
        assert.equal(res.symbol, 'NSE_EQ|INE002A01018');
        assert.equal(res.apiVersion, '2.0');
    });

    it('extracts error message from Upstox response', () => {
        const err = { response: { text: JSON.stringify({ errors: [{ message: 'Rate limit exceeded' }] }) } };
        assert.equal(extractUpstoxErrorMessage(err), 'Rate limit exceeded');
    });
});
