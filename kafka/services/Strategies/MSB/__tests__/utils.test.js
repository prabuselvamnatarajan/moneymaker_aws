import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    getLatestOHLCByInterval,
    getLTP,
    isValidI1Candle,
} from '../utils.js';

describe('MSB utils feed extraction', () => {
    it('reads I1 OHLC and LTP from fullFeed.marketFF', () => {
        const tick = {
            fullFeed: {
                marketFF: {
                    ltpc: { ltp: 204.15, ltt: 1720236001000 },
                    marketOHLC: {
                        ohlc: [
                            { interval: 'I1', open: 203, high: 205, low: 202, close: 204, ts: 1 },
                            { interval: 'I1', open: 204, high: 206, low: 203, close: 205, ts: 2 },
                        ],
                    },
                },
            },
        };

        const ohlc = getLatestOHLCByInterval(tick, 'I1');
        assert.equal(ohlc.high, 206);
        assert.equal(ohlc.low, 203);
        assert.equal(getLTP(tick), 204.15);
        assert.equal(isValidI1Candle(ohlc, getLTP(tick)), true);
    });

    it('reads I1 OHLC and LTP from top-level ltpc/marketOHLC', () => {
        const tick = {
            ltpc: { ltp: 22100, ltt: 1720236001000 },
            marketOHLC: {
                ohlc: [{ interval: 'I1', open: 22000, high: 22150, low: 21950, close: 22100, ts: 1 }],
            },
        };

        const ohlc = getLatestOHLCByInterval(tick, 'I1');
        assert.equal(ohlc.high, 22150);
        assert.equal(getLTP(tick), 22100);
        assert.equal(isValidI1Candle(ohlc, getLTP(tick)), true);
    });

    it('returns null when I1 interval is missing (no 1d fallback)', () => {
        const tick = {
            fullFeed: {
                indexFF: {
                    ltpc: { ltp: 22100 },
                    marketOHLC: {
                        ohlc: [{ interval: '1d', open: 22000, high: 22200, low: 21800, close: 22100, ts: 1 }],
                    },
                },
            },
        };

        assert.equal(getLatestOHLCByInterval(tick, 'I1'), null);
        assert.equal(isValidI1Candle(getLatestOHLCByInterval(tick, 'I1'), getLTP(tick)), false);
    });
});
