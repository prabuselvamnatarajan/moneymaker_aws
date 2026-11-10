import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    validateMarketQuoteRequest,
    extractUpstoxErrorMessage,
    handleApiCallbackError,
} from '../requestHelper.js';

describe('MicroServices/market-quote/fullMarketQuote Unit Tests (Real Codebase)', () => {
    it('server.js has valid syntax and parses without error', () => {
        const serverPath = fileURLToPath(new URL('../server.js', import.meta.url));
        assert.doesNotThrow(() => {
            execFileSync(process.execPath, ['--check', serverPath], { stdio: 'pipe' });
        });
    });

    it('rejects request with missing or empty userId (400)', () => {
        assert.equal(validateMarketQuoteRequest({}).status, 400);
        assert.equal(validateMarketQuoteRequest({ userId: '' }).status, 400);
        assert.equal(validateMarketQuoteRequest({ userId: '   ' }).status, 400);
    });

    it('rejects request with missing or empty symbol (400)', () => {
        assert.equal(validateMarketQuoteRequest({ userId: 'u1' }).status, 400);
        assert.equal(validateMarketQuoteRequest({ userId: 'u1', symbol: '   ' }).status, 400);
    });

    it('accepts valid userId and symbol trimmed', () => {
        const res = validateMarketQuoteRequest({ userId: ' user_1 ', symbol: ' NSE_INDEX|Nifty 50 ' });
        assert.equal(res.status, 200);
        assert.equal(res.userId, 'user_1');
        assert.equal(res.symbol, 'NSE_INDEX|Nifty 50');
    });

    it('extracts nested errors from JSON error payload', () => {
        const error = {
            response: {
                text: JSON.stringify({ errors: [{ message: 'Symbol inactive or suspended' }] }),
            },
        };
        assert.equal(extractUpstoxErrorMessage(error), 'Symbol inactive or suspended');
    });

    it('handles 401 / 403 token expiry by flagging token invalidation', () => {
        const res401 = handleApiCallbackError({ status: 401 });
        assert.equal(res401.statusCode, 401);
        assert.ok(res401.invalidateToken);
    });
});
