import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CandleAggregator } from '../src/core/candleAggregator.js';

describe('CandleAggregator - Production Code Tests', () => {
  it('initializes a fresh forming candle on the first tick', () => {
    const agg = new CandleAggregator('1m');
    const tick = {
      symbol: 'NIFTY',
      ltp: 24100.5,
      timestampMs: 1720236005000, // 09:20:05
      ltq: 50,
      vtt: 1000,
    };

    const res = agg.update(tick);
    assert.equal(res.timeframe, '1m');
    assert.equal(res.isRollover, false);
    assert.equal(res.closedCandle, null);
    assert.equal(res.candle.open, 24100.5);
    assert.equal(res.candle.high, 24100.5);
    assert.equal(res.candle.low, 24100.5);
    assert.equal(res.candle.close, 24100.5);
    assert.equal(res.candle.volume, 50);
    assert.equal(res.candle.isClosed, false);
    assert.equal(res.candle.startTime, 1720236000000);
    assert.equal(res.candle.endTime, 1720236060000);
  });

  it('updates OHLC and accumulates volume for intra-bar ticks', () => {
    const agg = new CandleAggregator('1m');
    const t0 = 1720236005000;

    agg.update({ symbol: 'NIFTY', ltp: 100, timestampMs: t0, ltq: 10 });
    agg.update({ symbol: 'NIFTY', ltp: 110, timestampMs: t0 + 10000, ltq: 15 });
    agg.update({ symbol: 'NIFTY', ltp: 95, timestampMs: t0 + 20000, ltq: 5 });
    const res = agg.update({ symbol: 'NIFTY', ltp: 105, timestampMs: t0 + 30000, ltq: 20 });

    assert.equal(res.candle.open, 100);
    assert.equal(res.candle.high, 110);
    assert.equal(res.candle.low, 95);
    assert.equal(res.candle.close, 105);
    assert.equal(res.candle.volume, 50); // 10 + 15 + 5 + 20
    assert.equal(res.candle.isClosed, false);
    assert.equal(res.closedCandle, null);
  });

  it('detects bucket rollover, emits closedCandle, and initializes new forming bar', () => {
    const agg = new CandleAggregator('1m');
    const t0 = 1720236005000; // Minute 0 (09:20:05)
    const t1 = 1720236065000; // Minute 1 (09:21:05) -> New 1m bucket!

    agg.update({ symbol: 'NIFTY', ltp: 100, timestampMs: t0, ltq: 10 });
    agg.update({ symbol: 'NIFTY', ltp: 115, timestampMs: t0 + 20000, ltq: 20 });

    const res = agg.update({ symbol: 'NIFTY', ltp: 112, timestampMs: t1, ltq: 30 });

    assert.equal(res.isRollover, true);
    assert.notEqual(res.closedCandle, null);
    assert.equal(res.closedCandle.isClosed, true);
    assert.equal(res.closedCandle.open, 100);
    assert.equal(res.closedCandle.high, 115);
    assert.equal(res.closedCandle.low, 100);
    assert.equal(res.closedCandle.close, 115);
    assert.equal(res.closedCandle.volume, 30);
    assert.equal(res.closedCandle.startTime, 1720236000000);
    assert.equal(res.closedCandle.endTime, 1720236060000);

    // New active forming candle
    assert.equal(res.candle.open, 112);
    assert.equal(res.candle.high, 112);
    assert.equal(res.candle.low, 112);
    assert.equal(res.candle.close, 112);
    assert.equal(res.candle.volume, 30);
    assert.equal(res.candle.isClosed, false);
    assert.equal(res.candle.startTime, 1720236060000);
    assert.equal(res.candle.endTime, 1720236120000);
  });

  it('calculates volume from cumulative vtt when per-tick ltq is zero', () => {
    const agg = new CandleAggregator('5m');
    const t0 = 1720236000000;

    // First tick with cumulative vtt = 5000
    agg.update({ symbol: 'NIFTY', ltp: 100, timestampMs: t0, ltq: 0, vtt: 5000 });
    // Second tick with cumulative vtt = 5200 (delta = 200)
    const res2 = agg.update({ symbol: 'NIFTY', ltp: 102, timestampMs: t0 + 5000, ltq: 0, vtt: 5200 });
    assert.equal(res2.candle.volume, 200);

    // Third tick with cumulative vtt = 5350 (delta = 150)
    const res3 = agg.update({ symbol: 'NIFTY', ltp: 101, timestampMs: t0 + 10000, ltq: 0, vtt: 5350 });
    assert.equal(res3.candle.volume, 350);
  });

  it('drops out-of-order ticks belonging to an older bucket without corrupting forming bar', () => {
    const agg = new CandleAggregator('5m');
    const t0 = 1720236300000; // Bucket 2 (09:25:00)

    agg.update({ symbol: 'NIFTY', ltp: 200, timestampMs: t0, ltq: 10 });
    agg.update({ symbol: 'NIFTY', ltp: 210, timestampMs: t0 + 10000, ltq: 10 });

    // Stale tick from Bucket 1 (09:20:00)
    const staleRes = agg.update({
      symbol: 'NIFTY',
      ltp: 50, // Should NOT overwrite low or close
      timestampMs: t0 - 120000, // 2 minutes in the past
      ltq: 100,
    });

    assert.equal(staleRes.isStale, true);
    assert.equal(staleRes.candle.low, 200); // Low intact
    assert.equal(staleRes.candle.close, 210); // Close intact
  });

  it('serializes to JSON and restores state accurately', () => {
    const agg = new CandleAggregator('15m');
    agg.update({ symbol: 'NIFTY', ltp: 500, timestampMs: 1720236000000, ltq: 100, vtt: 1000 });
    agg.update({ symbol: 'NIFTY', ltp: 520, timestampMs: 1720236010000, ltq: 50, vtt: 1050 });

    const serialized = agg.toJSON();
    assert.equal(serialized.timeframe, '15m');
    assert.equal(serialized.currentCandle.high, 520);
    assert.equal(serialized.currentCandle.volume, 150);

    const restored = new CandleAggregator('15m');
    restored.fromJSON(serialized);

    assert.equal(restored.currentCandle.high, 520);
    assert.equal(restored.currentCandle.volume, 150);
    assert.equal(restored.lastVtt, 1050);
  });
});
