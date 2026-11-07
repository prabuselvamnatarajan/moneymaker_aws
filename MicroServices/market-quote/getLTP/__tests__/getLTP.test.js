import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('MicroServices/market-quote/getLTP Unit Tests', () => {

    function validateRequest(query) {
        const userId = typeof query?.userId === 'string' ? query.userId.trim() : '';
        if (!userId) {
            return { status: 400, message: 'Bad Request: userId is required' };
        }
        const symbol = typeof query?.symbol === 'string' ? query.symbol.trim() : '';
        if (!symbol) {
            return { status: 400, message: 'Bad Request: symbol is required' };
        }
        return { status: 200, userId, symbol };
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

    function handleApiCallbackError(error) {
        const status = error.status || error.statusCode;
        if (status === 401 || status === 403) {
            return {
                statusCode: 401,
                body: 'Unauthorized: Invalid or expired Upstox access token — re-authenticate via Brokers page.',
                invalidateToken: true,
            };
        }
        return {
            statusCode: 500,
            body: `Internal Server Error: ${extractUpstoxErrorMessage(error)}`,
            invalidateToken: false,
        };
    }

    it('rejects request with missing or empty userId (400)', () => {
        assert.equal(validateRequest({}).status, 400);
        assert.equal(validateRequest({ userId: '' }).status, 400);
        assert.equal(validateRequest({ userId: '   ' }).status, 400);
        assert.equal(validateRequest({ userId: null }).status, 400);
    });

    it('rejects request with missing or empty symbol (400)', () => {
        assert.equal(validateRequest({ userId: 'user_1' }).status, 400);
        assert.equal(validateRequest({ userId: 'user_1', symbol: '' }).status, 400);
        assert.equal(validateRequest({ userId: 'user_1', symbol: '   ' }).status, 400);
    });

    it('accepts valid userId and symbol trimmed', () => {
        const result = validateRequest({ userId: ' user_1 ', symbol: ' NSE_EQ|INE002A01018 ' });
        assert.equal(result.status, 200);
        assert.equal(result.userId, 'user_1');
        assert.equal(result.symbol, 'NSE_EQ|INE002A01018');
    });

    it('extracts human-readable error from Upstox error JSON response', () => {
        const errWithJson = {
            response: {
                text: JSON.stringify({
                    errors: [{ message: 'Instrument key not found or expired' }],
                }),
            },
        };
        assert.equal(extractUpstoxErrorMessage(errWithJson), 'Instrument key not found or expired');
    });

    it('falls back to error.message when text is not JSON', () => {
        const err = { message: 'Network Timeout', response: { text: '<html>Error</html>' } };
        assert.equal(extractUpstoxErrorMessage(err), 'Network Timeout');
    });

    it('handles 401 / 403 token expiry by flagging token invalidation', () => {
        const err401 = { status: 401, message: 'Unauthorized' };
        const res401 = handleApiCallbackError(err401);
        assert.equal(res401.statusCode, 401);
        assert.ok(res401.invalidateToken);
        assert.ok(res401.body.includes('re-authenticate'));

        const err403 = { statusCode: 403, message: 'Forbidden' };
        const res403 = handleApiCallbackError(err403);
        assert.equal(res403.statusCode, 401);
        assert.ok(res403.invalidateToken);
    });

    it('returns 500 for generic Upstox server errors without token invalidation', () => {
        const err500 = { status: 500, message: 'Internal Server Error' };
        const res500 = handleApiCallbackError(err500);
        assert.equal(res500.statusCode, 500);
        assert.equal(res500.invalidateToken, false);
    });
});
