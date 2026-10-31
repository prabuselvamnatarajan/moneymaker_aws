import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRedisKeyPrefix } from '../Init/redisKey.js';

describe('appInit / normalizeRedisKeyPrefix', () => {
    it('strips a trailing colon before key construction', () => {
        assert.equal(normalizeRedisKeyPrefix('strategies:live:'), 'strategies:live');
    });

    it('leaves keys without a trailing colon unchanged', () => {
        assert.equal(normalizeRedisKeyPrefix('websocketlistening:live'), 'websocketlistening:live');
    });

    it('does not throw on non-string keys', () => {
        assert.equal(normalizeRedisKeyPrefix(undefined), undefined);
        assert.equal(normalizeRedisKeyPrefix(null), null);
    });
});
