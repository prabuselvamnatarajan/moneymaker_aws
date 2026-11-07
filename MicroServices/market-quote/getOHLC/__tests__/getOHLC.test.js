import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    validateOhlcRequest,
    extractUpstoxErrorMessage,
    handleApiCallbackError,
} from '../requestHelper.js';

describe('MicroServices/market-quote/getOHLC Unit Tests (Real Codebase)', () => {

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

    it('handles 401 / 403 token expiry by flagging token invalidation', () => {
        const res401 = handleApiCallbackError({ status: 401 });
        assert.equal(res401.statusCode, 401);
        assert.ok(res401.invalidateToken);
    });
});
