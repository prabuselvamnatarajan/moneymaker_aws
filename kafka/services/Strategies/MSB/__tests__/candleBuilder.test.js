import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeframeCandle, timeframeToMs, resolveTickTimestampMs } from '../candleBuilder.js';

describe('CandleBuilder Multi-Timeframe Tests', () => {
    it('correctly maps 1m, 3m, 5m, 15m timeframes to milliseconds', () => {
        assert.equal(timeframeToMs('1m'), 60000);
        assert.equal(timeframeToMs('1minute'), 60000);
        assert.equal(timeframeToMs('3m'), 180000);
        assert.equal(timeframeToMs('3minute'), 180000);
        assert.equal(timeframeToMs('5m'), 300000);
        assert.equal(timeframeToMs('5minute'), 300000);
        assert.equal(timeframeToMs('15m'), 900000);
        assert.equal(timeframeToMs('15minute'), 900000);
    });

    it('throws explicit error on unsupported timeframe (Fail Loud)', () => {
        assert.throws(() => timeframeToMs('2m'), /Unsupported timeframe/);
        assert.throws(() => timeframeToMs('hourly'), /Unsupported timeframe/);
        assert.throws(() => timeframeToMs(''), /timeframe is required/);
        assert.throws(() => timeframeToMs(null), /timeframe is required/);
    });

    it('fails loudly when tick has no ltt and no timestamp', () => {
        assert.throws(
            () => resolveTickTimestampMs({ ltpc: { ltp: 100 } }),
            /missing ltpc.ltt/
        );
    });

    it('prefers ltpc.ltt over server timestamp', () => {
        const ltt = 1720236005000;
        const msg = {
            timestamp: '2020-01-01T00:00:00.000Z',
            ltpc: { ltp: 100, ltt },
        };
        assert.equal(resolveTickTimestampMs(msg), ltt);
    });

    it('aggregates candles deterministically within a 5m time bucket from tick LTP/LTT', () => {
        const ts1 = 1720236005000; // 09:15:05
        const ts2 = 1720236025000; // 09:15:25
        const ts3 = 1720236305000; // 09:20:05 (New 5m bucket!)

        const tick1 = { ltpc: { ltp: 100, ltt: ts1 } };
        const res1 = buildTimeframeCandle(tick1, '5m', null);
        assert.equal(res1.candle.open, 100);
        assert.equal(res1.candle.high, 100);
        assert.equal(res1.candle.low, 100);
        assert.equal(res1.candle.close, 100);

        const tick2 = { ltpc: { ltp: 110, ltt: ts2 } };
        const res2 = buildTimeframeCandle(tick2, '5m', res1.newCandleState);
        assert.equal(res2.candle.open, 100);
        assert.equal(res2.candle.high, 110);
        assert.equal(res2.candle.low, 100);
        assert.equal(res2.candle.close, 110);

        const tick3 = { ltpc: { ltp: 105, ltt: ts3 } };
        const res3 = buildTimeframeCandle(tick3, '5m', res2.newCandleState);
        assert.equal(res3.candle.open, 105);
        assert.equal(res3.candle.high, 105);
        assert.equal(res3.candle.low, 105);
        assert.equal(res3.candle.close, 105);
    });

    it('ignores I1 / marketOHLC and builds OHLC only from tick LTP', () => {
        const ts = 1720236005000;
        const tick = {
            ltpc: { ltp: 100, ltt: ts },
            marketOHLC: {
                ohlc: [
                    { interval: 'I1', open: 1, high: 999, low: 1, close: 50, ts: ts - 1000 },
                    { interval: 'I1', open: 2, high: 888, low: 2, close: 50, ts: ts },
                ],
            },
        };

        const res = buildTimeframeCandle(tick, '1m', null);
        assert.equal(res.candle.open, 100);
        assert.equal(res.candle.high, 100);
        assert.equal(res.candle.low, 100);
        assert.equal(res.candle.close, 100);

        const tick2 = {
            ltpc: { ltp: 102, ltt: ts + 1000 },
            marketOHLC: {
                ohlc: [{ interval: 'I1', open: 1, high: 999, low: 1, close: 50, ts: ts + 1000 }],
            },
        };
        const res2 = buildTimeframeCandle(tick2, '1m', res.newCandleState);
        assert.equal(res2.candle.open, 100);
        assert.equal(res2.candle.high, 102);
        assert.equal(res2.candle.low, 100);
        assert.equal(res2.candle.close, 102);
    });

    it('resets candle when stored interval differs from requested timeframe', () => {
        const ts = 1720236005000;
        const staleState = {
            bucketStartMs: Math.floor(ts / 300000) * 300000,
            open: 50,
            high: 80,
            low: 40,
            close: 70,
            timestamp: new Date(ts).toISOString(),
            interval: '5m',
        };
        const tick = { ltpc: { ltp: 100, ltt: ts } };
        const res = buildTimeframeCandle(tick, '1m', staleState);
        assert.equal(res.candle.open, 100);
        assert.equal(res.candle.high, 100);
        assert.equal(res.newCandleState.interval, '1m');
    });

    it('reads LTP/LTT from fullFeed.marketFF', () => {
        const ts = 1720236005000;
        const tick = {
            fullFeed: {
                marketFF: {
                    ltpc: { ltp: 22100.5, ltt: ts },
                },
            },
        };
        const res = buildTimeframeCandle(tick, '3m', null);
        assert.equal(res.candle.open, 22100.5);
        assert.equal(res.candle.close, 22100.5);
        assert.equal(res.newCandleState.bucketStartMs, Math.floor(ts / 180000) * 180000);
    });
});
