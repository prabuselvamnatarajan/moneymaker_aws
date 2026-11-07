import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mongoCollectionNameForSymbol, buildStoreDocument } from '../storeDocument.js';

describe('storerConsumer Edge Cases & Document Ingestion Tests', () => {

    it('buildStoreDocument preserves all fields from incoming tick while injecting timestamp', () => {
        const tick = {
            ltp: 24150.25,
            volume: 1500,
            fullFeed: { marketFF: { ltpc: { ltp: 24150.25 } } },
        };
        const doc = buildStoreDocument(tick);

        assert.equal(doc.ltp, 24150.25);
        assert.equal(doc.volume, 1500);
        assert.deepEqual(doc.fullFeed, tick.fullFeed);
        assert.ok(doc.timestamp instanceof Date);
    });

    it('handles special characters in symbol collection names', () => {
        assert.equal(mongoCollectionNameForSymbol('NSE_INDEX|Nifty Bank'), 'NSE_INDEX|Nifty Bank');
        assert.equal(mongoCollectionNameForSymbol('BSE_EQ:500180'), 'BSE_EQ:500180');
    });

    it('handles message payload parsing safely and flags non-JSON input', () => {
        function parseMessageValue(bufferOrString) {
            return JSON.parse(bufferOrString.toString());
        }

        assert.throws(
            () => parseMessageValue('NOT_JSON_PAYLOAD'),
            { name: 'SyntaxError' }
        );

        const valid = parseMessageValue(JSON.stringify({ test: 123 }));
        assert.equal(valid.test, 123);
    });
});
