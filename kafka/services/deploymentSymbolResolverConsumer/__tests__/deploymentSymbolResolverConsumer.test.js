import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractLtp } from '../extractLtp.js';

describe('deploymentSymbolResolverConsumer extractLtp', () => {
    it('returns null for non-objects', () => {
        assert.equal(extractLtp(null), null);
        assert.equal(extractLtp('string'), null);
    });

    it('returns a numeric ltp field directly', () => {
        assert.equal(extractLtp({ ltp: 100 }), 100);
    });

    it('reads ltp from fullFeed.marketFF.ltpc', () => {
        assert.equal(extractLtp({ fullFeed: { marketFF: { ltpc: { ltp: 24123.5 } } } }), 24123.5);
    });
});
