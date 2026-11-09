const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    sanitize,
    extractFeed,
    extractLtp,
    extractTickTimeMs,
} = require('../streamerUtils.js');

describe('BackTest/BacktestStreamer Unit Tests (Real Codebase)', () => {

    it('sanitizes symbol names with dangerous path characters', () => {
        assert.equal(sanitize('../../../etc/passwd'), '_________etc_passwd');
        assert.equal(sanitize('NSE_EQ|INE002A01018'), 'NSE_EQ_INE002A01018');
        assert.equal(sanitize('NIFTY:50*'), 'NIFTY_50_');
        assert.equal(sanitize('TCS'), 'TCS');
    });

    it('extracts feed correctly across feed variants', () => {
        assert.equal(extractFeed(null), null);
        assert.equal(extractFeed(123), null);

        const marketFF = { ltpc: { ltp: 100 } };
        assert.deepEqual(extractFeed({ fullFeed: { marketFF } }), marketFF);

        const indexFF = { ltpc: { ltp: 24000 } };
        assert.deepEqual(extractFeed({ fullFeed: { indexFF } }), indexFF);

        assert.deepEqual(extractFeed({ marketFF }), marketFF);
        assert.deepEqual(extractFeed({ feed: marketFF }), marketFF);
    });

    it('extracts valid positive finite numeric LTP', () => {
        assert.equal(extractLtp({ ltp: 150.5 }), 150.5);
        assert.equal(extractLtp({ ltpc: { ltp: 200 } }), 200);
        assert.equal(extractLtp({ fullFeed: { marketFF: { ltpc: { ltp: '250.75' } } } }), 250.75);

        // Invalid cases
        assert.equal(extractLtp(null), null);
        assert.equal(extractLtp({ ltp: 0 }), null);
        assert.equal(extractLtp({ ltp: -10 }), null);
        assert.equal(extractLtp({ ltp: 'not_a_number' }), null);
        assert.equal(extractLtp({ ltp: null }), null);
    });

    it('extracts tick timestamp prioritizing ltpc.ltt over item.timestamp', () => {
        const itemWithBoth = {
            timestamp: '2024-01-01T09:15:00Z',
            ltpc: { ltt: 1704099999000 },
        };
        assert.equal(extractTickTimeMs(itemWithBoth), 1704099999000);

        const itemWithTimestampOnly = {
            timestamp: '2024-01-01T09:15:00.000Z',
        };
        assert.equal(extractTickTimeMs(itemWithTimestampOnly), new Date('2024-01-01T09:15:00.000Z').getTime());

        assert.equal(extractTickTimeMs(null), null);
        assert.equal(extractTickTimeMs({}), null);
    });

    it('tracks lastLtp and lastTickAt for final done signal', () => {
        const streamData = [
            { ltp: 100, ltpc: { ltt: 1000 } },
            { ltp: 105, ltpc: { ltt: 2000 } },
            { ltp: 102, ltpc: { ltt: 3000 } },
        ];

        let lastLtp = null;
        let lastTickAt = null;

        for (const item of streamData) {
            const ltp = extractLtp(item);
            if (ltp != null) {
                lastLtp = ltp;
                lastTickAt = extractTickTimeMs(item);
            }
        }

        assert.equal(lastLtp, 102);
        assert.equal(lastTickAt, 3000);
    });
});
