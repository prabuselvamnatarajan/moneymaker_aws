import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotGenerator } from '../src/core/snapshotGenerator.js';

describe('SnapshotGenerator - Production Code Tests', () => {
  it('formats standardized multi-timeframe snapshot event with clean eventId', () => {
    const processed = {
      symbol: 'NSE_INDEX|Nifty 50',
      eventTimestamp: 1720236005000,
      snapshotVersion: 42,
      ltp: 24100,
      volume: 100,
      timeframes: {
        '1m': { open: 24100, high: 24100, low: 24100, close: 24100, volume: 100, isClosed: false },
        '5m': { open: 24100, high: 24100, low: 24100, close: 24100, volume: 100, isClosed: false },
      },
    };

    const snapshot = SnapshotGenerator.generate(processed);

    assert.equal(snapshot.symbol, 'NSE_INDEX|Nifty 50');
    assert.equal(snapshot.eventTimestamp, 1720236005000);
    assert.equal(snapshot.snapshotVersion, 42);
    assert.equal(snapshot.ltp, 24100);
    assert.equal(snapshot.volume, 100);
    assert.ok(snapshot.timeframes['1m']);
    assert.ok(snapshot.timeframes['5m']);

    // EventId should sanitize pipes and spaces
    assert.equal(snapshot.eventId, 'tf_NSE_INDEX_Nifty_50_1720236005000_42');
  });
});
