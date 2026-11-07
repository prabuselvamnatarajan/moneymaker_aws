import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    validateFundsRequest,
    extractUpstoxErrorMessage,
    handleApiCallbackError,
} from '../requestHelper.js';

describe('MicroServices/Users/FundsAndMargin requestHelper (Real Codebase)', () => {
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

        const generic = new Error('Connection reset');
        assert.equal(extractUpstoxErrorMessage(generic), 'Connection reset');

        assert.equal(extractUpstoxErrorMessage(null), 'Upstox API request failed');
    });

    it('handles 401 token expiration by returning 401 and flagging invalidation', () => {
        const err = { status: 401 };
        const res = handleApiCallbackError(err);
        assert.equal(res.statusCode, 401);
        assert.ok(res.invalidateToken);
        assert.ok(res.body.includes('re-authenticate via Brokers page'));
    });

    it('handles 500 server errors without invalidating token', () => {
        const err = { status: 500, message: 'Upstox database timeout' };
        const res = handleApiCallbackError(err);
        assert.equal(res.statusCode, 500);
        assert.equal(res.invalidateToken, false);
        assert.ok(res.body.includes('Upstox database timeout'));
    });
});
