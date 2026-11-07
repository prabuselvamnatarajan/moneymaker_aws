import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('MicroServices/market-quote/getOHLC Unit Tests', () => {

    function validateOhlcRequest(query) {
        const userId = typeof query?.userId === 'string' ? query.userId.trim() : '';
        if (!userId) {
            return { status: 400, message: 'Bad Request: userId is required' };
        }
        const symbol = typeof query?.symbol === 'string' ? query.symbol.trim() : '';
        if (!symbol) {
            return { status: 400, message: 'Bad Request: symbol is required' };
        }
        const interval = typeof query?.interval === 'string' && query.interval.trim()
            ? query.interval.trim()
            : 'I1';

        return { status: 200, userId, symbol, interval };
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
        assert.equal(validateOhlcRequest({}).status, 400);
        assert.equal(validateOhlcRequest({ userId: '' }).status, 400);
    });

    it('rejects request with missing or empty symbol (400)', () => {
        assert.equal(validateOhlcRequest({ userId: 'u1' }).status, 400);
        assert.equal(validateOhlcRequest({ userId: 'u1', symbol: '   ' }).status, 400);
    });

    it('defaults interval to I1 when omitted or whitespace', () => {
        const res1 = validateOhlcRequest({ userId: 'u1', symbol: 'SYM' });
        assert.equal(res1.status, 200);
        assert.equal(res1.interval, 'I1');

        const res2 = validateOhlcRequest({ userId: 'u1', symbol: 'SYM', interval: '   ' });
        assert.equal(res2.status, 200);
        assert.equal(res2.interval, 'I1');
    });

    it('preserves custom interval when provided (e.g. 1d, 30m)', () => {
        const res = validateOhlcRequest({ userId: 'u1', symbol: 'SYM', interval: '1d' });
        assert.equal(res.status, 200);
        assert.equal(res.interval, '1d');
    });

    it('extracts nested errors correctly', () => {
        const error = {
            response: {
                text: JSON.stringify({ errors: [{ message: 'Historical data unavailable' }] }),
            },
        };
        assert.equal(extractUpstoxErrorMessage(error), 'Historical data unavailable');
    });
});
