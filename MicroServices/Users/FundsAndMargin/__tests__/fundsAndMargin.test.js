import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('MicroServices/Users/FundsAndMargin Unit Tests', () => {

    function validateFundsRequest(query) {
        const userId = typeof query?.userId === 'string' ? query.userId.trim() : '';
        if (!userId) {
            return { status: 400, message: 'Bad Request: userId is required' };
        }
        return { status: 200, userId, apiVersion: '2.0' };
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
        assert.equal(validateFundsRequest({}).status, 400);
        assert.equal(validateFundsRequest({ userId: '' }).status, 400);
        assert.equal(validateFundsRequest({ userId: '   ' }).status, 400);
        assert.equal(validateFundsRequest({ userId: null }).status, 400);
    });

    it('validates request successfully and enforces apiVersion 2.0', () => {
        const res = validateFundsRequest({ userId: ' user_123 ' });
        assert.equal(res.status, 200);
        assert.equal(res.userId, 'user_123');
        assert.equal(res.apiVersion, '2.0');
    });

    it('extracts human-readable error from Upstox error JSON', () => {
        const err = { response: { text: JSON.stringify({ errors: [{ message: 'User not registered with broker' }] }) } };
        assert.equal(extractUpstoxErrorMessage(err), 'User not registered with broker');
    });

    it('handles 401 token expiration by returning 401 and flagging invalidation', () => {
        const err = { status: 401 };
        const res = handleApiCallbackError(err);
        assert.equal(res.statusCode, 401);
        assert.ok(res.invalidateToken);
    });
});
