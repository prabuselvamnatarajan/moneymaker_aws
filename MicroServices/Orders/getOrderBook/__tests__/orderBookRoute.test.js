import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('MicroServices/Orders/getOrderBook Route & Validation Tests', () => {

    function validateOrderBookRequest(query) {
        const userId = typeof query?.userId === 'string' ? query.userId.trim() : '';
        if (!userId) {
            return { status: 400, message: 'Bad Request: userId is required' };
        }
        return { status: 200, userId, apiVersion: '2.0' };
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
            body: `Internal Server Error: ${error.message || 'Request failed'}`,
            invalidateToken: false,
        };
    }

    it('rejects orderbook request with missing or empty userId (400)', () => {
        assert.equal(validateOrderBookRequest({}).status, 400);
        assert.equal(validateOrderBookRequest({ userId: '' }).status, 400);
        assert.equal(validateOrderBookRequest({ userId: '   ' }).status, 400);
    });

    it('accepts valid userId and enforces apiVersion 2.0', () => {
        const res = validateOrderBookRequest({ userId: ' user_order_1 ' });
        assert.equal(res.status, 200);
        assert.equal(res.userId, 'user_order_1');
        assert.equal(res.apiVersion, '2.0');
    });

    it('handles 401/403 Upstox token expiry with token invalidation flag', () => {
        const res401 = handleApiCallbackError({ status: 401 });
        assert.equal(res401.statusCode, 401);
        assert.equal(res401.invalidateToken, true);

        const res403 = handleApiCallbackError({ statusCode: 403 });
        assert.equal(res403.statusCode, 401);
        assert.equal(res403.invalidateToken, true);
    });

    it('handles 500 generic error without token invalidation', () => {
        const res500 = handleApiCallbackError({ status: 500, message: 'Upstox internal server error' });
        assert.equal(res500.statusCode, 500);
        assert.equal(res500.invalidateToken, false);
    });
});
