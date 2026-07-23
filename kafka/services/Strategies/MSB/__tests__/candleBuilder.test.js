import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeframeCandle, timeframeToMs } from '../candleBuilder.js';

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
    });

    it('aggregates candles deterministically within a 5m time bucket', () => {
        // 09:15:05 IST = 1720000000000 approx base ts
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
});
