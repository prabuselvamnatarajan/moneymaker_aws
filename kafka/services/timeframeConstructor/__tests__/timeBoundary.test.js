import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTimeframe,
  timeframeToMs,
  calculateBucketStart,
  calculateBucketEnd,
  isMarketHours,
  TIMEFRAME_CONFIG,
  IST_OFFSET_MS,
} from '../src/core/timeBoundary.js';

describe('timeBoundary - Production Code Tests', () => {
  it('normalizes standard timeframe strings and aliases', () => {
    assert.equal(normalizeTimeframe('1m'), '1m');
    assert.equal(normalizeTimeframe('1minute'), '1m');
    assert.equal(normalizeTimeframe('1_minute'), '1m');
    assert.equal(normalizeTimeframe('3m'), '3m');
    assert.equal(normalizeTimeframe('3minute'), '3m');
    assert.equal(normalizeTimeframe('5m'), '5m');
    assert.equal(normalizeTimeframe('5minute'), '5m');
    assert.equal(normalizeTimeframe('15m'), '15m');
    assert.equal(normalizeTimeframe('15minute'), '15m');
    assert.equal(normalizeTimeframe('30m'), '30m');
    assert.equal(normalizeTimeframe('1h'), '1h');
    assert.equal(normalizeTimeframe('1d'), '1d');
  });

  it('fails loud on missing or unsupported timeframes', () => {
    assert.throws(() => normalizeTimeframe(''), /timeframe is required/);
    assert.throws(() => normalizeTimeframe(null), /timeframe is required/);
    assert.throws(() => normalizeTimeframe(undefined), /timeframe is required/);
    assert.throws(() => normalizeTimeframe('2m'), /Unsupported timeframe/);
    assert.throws(() => normalizeTimeframe('45m'), /Unsupported timeframe/);
    assert.throws(() => normalizeTimeframe('weekly'), /Unsupported timeframe/);
  });

  it('accurately converts all timeframes to milliseconds', () => {
    assert.equal(timeframeToMs('1m'), 60_000);
    assert.equal(timeframeToMs('3m'), 180_000);
    assert.equal(timeframeToMs('5m'), 300_000);
    assert.equal(timeframeToMs('15m'), 900_000);
    assert.equal(timeframeToMs('30m'), 1_800_000);
    assert.equal(timeframeToMs('1h'), 3_600_000);
    assert.equal(timeframeToMs('1d'), 86_400_000);
  });

  it('calculates deterministic bucket start and end timestamps', () => {
    // 09:15:23 UTC -> 1720238123000 ms
    const ts = 1720238123000;
    const interval1m = 60_000;
    const interval5m = 300_000;

    const start1m = calculateBucketStart(ts, interval1m);
    assert.equal(start1m, Math.floor(ts / interval1m) * interval1m);
    assert.equal(calculateBucketEnd(start1m, interval1m), start1m + interval1m);

    const start5m = calculateBucketStart(ts, interval5m);
    assert.equal(start5m, Math.floor(ts / interval5m) * interval5m);
    assert.equal(calculateBucketEnd(start5m, interval5m), start5m + interval5m);
  });

  it('fails loudly when bucket calculations receive invalid inputs', () => {
    assert.throws(() => calculateBucketStart(0, 60000), /Invalid timestampMs/);
    assert.throws(() => calculateBucketStart(-100, 60000), /Invalid timestampMs/);
    assert.throws(() => calculateBucketStart(1720000000000, 0), /Invalid intervalMs/);
    assert.throws(() => calculateBucketStart(1720000000000, -60000), /Invalid intervalMs/);
  });

  it('determines Indian market hours (09:15 - 15:30 IST) correctly', () => {
    // Construct 09:15:00 IST on 2024-07-08
    // 09:15 IST = 03:45 UTC
    const dateAt915 = new Date('2024-07-08T03:45:00.000Z').getTime();
    assert.equal(isMarketHours(dateAt915), true);

    // 12:00:00 IST = 06:30 UTC
    const dateAt1200 = new Date('2024-07-08T06:30:00.000Z').getTime();
    assert.equal(isMarketHours(dateAt1200), true);

    // 15:30:00 IST = 10:00 UTC
    const dateAt1530 = new Date('2024-07-08T10:00:00.000Z').getTime();
    assert.equal(isMarketHours(dateAt1530), true);

    // Pre-market: 09:14:59 IST = 03:44:59 UTC
    const datePreMarket = new Date('2024-07-08T03:44:59.000Z').getTime();
    assert.equal(isMarketHours(datePreMarket), false);

    // Post-market: 15:30:01 IST = 10:00:01 UTC
    const datePostMarket = new Date('2024-07-08T10:00:01.000Z').getTime();
    assert.equal(isMarketHours(datePostMarket), false);

    // Invalid timestamp
    assert.equal(isMarketHours(-1), false);
    assert.equal(isMarketHours(null), false);
  });
});
