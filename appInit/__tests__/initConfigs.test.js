import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRedisKeyPrefix } from '../Init/redisKey.js';

describe('appInit Configs & Key Resolution Tests', () => {

    function buildItemKey(redisKey, item, targetProperty) {
        const propertyValue = item ? item[targetProperty] : undefined;
        if (propertyValue === undefined) {
            return null;
        }
        const cleanRedisKey = normalizeRedisKeyPrefix(redisKey);
        return `${cleanRedisKey}:${propertyValue}`;
    }

    it('builds item key by combining clean prefix with target property value', () => {
        const item = { symbol: 'RELIANCE', name: 'Reliance Industries' };
        const key = buildItemKey('strategies:live:', item, 'symbol');
        assert.equal(key, 'strategies:live:RELIANCE');
    });

    it('returns null when document is missing the target property', () => {
        const item = { name: 'No Symbol' };
        const key = buildItemKey('strategies:live:', item, 'symbol');
        assert.equal(key, null);
    });

    it('handles nested or string keys without trailing colon cleanly', () => {
        const item = { token: '12345' };
        const key = buildItemKey('websocket:listening', item, 'token');
        assert.equal(key, 'websocket:listening:12345');
    });
});
