import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PersistenceService } from '../src/storage/persistenceService.js';
import { SymbolTimeframeState } from '../src/core/symbolStateManager.js';

describe('PersistenceService - Production Code Tests', () => {
  it('saves symbol state to redis with key prefix and TTL', async () => {
    const redisStore = new Map();
    const mockRedisClient = {
      async setEx(key, ttl, value) {
        redisStore.set(key, { ttl, value });
      },
    };

    const persistence = new PersistenceService(mockRedisClient, 'tf_test_state');
    const symbolState = new SymbolTimeframeState('NIFTY', ['1m', '5m']);
    symbolState.processTick({
      symbol: 'NIFTY',
      ltp: 24100,
      timestampMs: 1720236000000,
      ltq: 50,
    });

    await persistence.saveSymbolState(symbolState, 3600);

    const saved = redisStore.get('tf_test_state:NIFTY');
    assert.notEqual(saved, undefined);
    assert.equal(saved.ttl, 3600);
    const parsed = JSON.parse(saved.value);
    assert.equal(parsed.symbol, 'NIFTY');
    assert.equal(parsed.snapshotVersion, 1);
  });

  it('hydrates symbol state from redis', async () => {
    const mockData = {
      symbol: 'BANKNIFTY',
      snapshotVersion: 5,
      lastProcessedTimestamp: 1720236010000,
      aggregators: {
        '1m': {
          timeframe: '1m',
          intervalMs: 60000,
          currentCandle: {
            startTime: 1720236000000,
            endTime: 1720236060000,
            open: 51000,
            high: 51050,
            low: 50980,
            close: 51020,
            volume: 250,
            isClosed: false,
          },
        },
      },
    };

    const mockRedisClient = {
      async get(key) {
        if (key === 'timeframe_state:BANKNIFTY') {
          return JSON.stringify(mockData);
        }
        return null;
      },
    };

    const persistence = new PersistenceService(mockRedisClient);
    const targetState = new SymbolTimeframeState('BANKNIFTY', ['1m']);

    const restored = await persistence.loadSymbolState(targetState);
    assert.equal(restored, true);
    assert.equal(targetState.snapshotVersion, 5);
    assert.equal(targetState.aggregators.get('1m').currentCandle.close, 51020);
    assert.equal(targetState.aggregators.get('1m').currentCandle.volume, 250);

    // Non-existent key returns false
    const missingState = new SymbolTimeframeState('RELIANCE');
    const restoredMissing = await persistence.loadSymbolState(missingState);
    assert.equal(restoredMissing, false);
  });
});
