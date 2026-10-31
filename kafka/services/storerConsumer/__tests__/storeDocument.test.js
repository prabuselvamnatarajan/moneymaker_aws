import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mongoCollectionNameForSymbol, buildStoreDocument } from '../storeDocument.js';

describe('storerConsumer store helpers', () => {
    it('stores each symbol in its own collection', () => {
        assert.equal(mongoCollectionNameForSymbol('NSE_EQ|SBIN'), 'NSE_EQ|SBIN');
        assert.equal(mongoCollectionNameForSymbol('order-token-1'), 'order-token-1');
    });

    it('wraps the tick with a timestamp and does not add symbol_name', () => {
        const doc = buildStoreDocument({ ltp: 100, volume: 2 });
        assert.equal(doc.ltp, 100);
        assert.equal(doc.volume, 2);
        assert.ok(doc.timestamp instanceof Date);
        assert.equal('symbol_name' in doc, false);
    });
});
