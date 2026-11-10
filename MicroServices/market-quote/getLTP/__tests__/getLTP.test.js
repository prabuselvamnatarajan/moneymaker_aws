import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    validateLtpRequest,
    extractUpstoxErrorMessage,
    handleApiCallbackError,
} from '../requestHelper.js';

describe('MicroServices/market-quote/getLTP Unit Tests (Real Codebase)', () => {
    it('server.js has valid syntax and parses without error', () => {
        const serverPath = fileURLToPath(new URL('../server.js', import.meta.url));
        assert.doesNotThrow(() => {
            execFileSync(process.execPath, ['--check', serverPath], { stdio: 'pipe' });
        });
    });

    it('rejects request with missing or empty userId (400)', () => {
        assert.equal(validateLtpRequest({}).status, 400);
        assert.equal(validateLtpRequest({ userId: '' }).status, 400);
        assert.equal(validateLtpRequest({ userId: '   ' }).status, 400);
        assert.equal(validateLtpRequest({ userId: null }).status, 400);
    });

    it('rejects request with missing or empty symbol (400)', () => {
        assert.equal(validateLtpRequest({ userId: 'user_1' }).status, 400);
        assert.equal(validateLtpRequest({ userId: 'user_1', symbol: '' }).status, 400);
        assert.equal(validateLtpRequest({ userId: 'user_1', symbol: '   ' }).status, 400);
    });

    it('accepts valid userId and symbol trimmed', () => {
        const result = validateLtpRequest({ userId: ' user_1 ', symbol: ' NSE_EQ|INE002A01018 ' });
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
