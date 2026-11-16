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
      async set(key, value) {
        redisStore.set(key, { value });
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
        if (key === 'timeframe_state:BANKNIFTY' || key === 'timeframe:state:BANKNIFTY') {
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

  it('loads and saves dynamic timeframe requirements per symbol', async () => {
    const redisStore = new Map();
    const mockRedisClient = {
      async get(key) {
        return redisStore.get(key) || null;
      },
      async set(key, value) {
        redisStore.set(key, value);
      },
    };

    const persistence = new PersistenceService(mockRedisClient);

    // No requirements initially returns null
    const initial = await persistence.getTimeframeRequirements('TCS');
    assert.equal(initial, null);

    // Save combined requirements for TCS: 3m and 15m
    await persistence.saveTimeframeRequirements('TCS', ['3m', '15m']);

    const loadedLive = await persistence.getTimeframeRequirements('TCS', false);
    assert.deepEqual(loadedLive, ['3m', '15m']);

    // Check that alias and requirement keys are stored
    assert.ok(redisStore.has('timeframe:requirements:TCS'));
    assert.ok(redisStore.has('symbol:timeframes:TCS'));

    // Save and load backtest requirements
    await persistence.saveTimeframeRequirements('INFY', ['1m', '5m'], true, 'dep_bt_42');
    const loadedBt = await persistence.getTimeframeRequirements('INFY', true, 'dep_bt_42');
    assert.deepEqual(loadedBt, ['1m', '5m']);
  });

  it('stores intermediate candle state as an object where key is timeframe and value is candle data', async () => {
    const redisStore = new Map();
    const mockRedisClient = {
      async get(key) {
        return redisStore.get(key) || null;
      },
      async setEx(key, ttl, value) {
        redisStore.set(key, value);
      },
      async set(key, value) {
        redisStore.set(key, value);
      },
    };

    const persistence = new PersistenceService(mockRedisClient);

    const intermediateState = {
      '1m': {
        timeframe: '1m',
        intervalMs: 60000,
        currentCandle: {
          startTime: 1720236000000,
          endTime: 1720236060000,
          open: 24000,
          high: 24050,
          low: 23980,
          close: 24020,
          volume: 500,
          isClosed: false,
          updatedAt: 1720236015000,
        },
        previousCandle: null,
        lastVtt: 5000,
      },
      '5m': {
        timeframe: '5m',
        intervalMs: 300000,
        currentCandle: {
          startTime: 1720236000000,
          endTime: 1720236300000,
          open: 24000,
          high: 24050,
          low: 23980,
          close: 24020,
          volume: 500,
          isClosed: false,
          updatedAt: 1720236015000,
        },
        previousCandle: null,
        lastVtt: 5000,
      },
    };

    await persistence.saveSymbolIntermediateState('NIFTY', intermediateState);

    const loaded = await persistence.getSymbolIntermediateState('NIFTY');
    assert.ok(loaded['1m']);
    assert.ok(loaded['5m']);
    assert.equal(loaded['1m'].currentCandle.close, 24020);
    assert.equal(loaded['5m'].currentCandle.volume, 500);

    // Verify key in Redis is timeframe:state:NIFTY
    const rawStored = redisStore.get('timeframe:state:NIFTY');
    assert.notEqual(rawStored, undefined);
    const parsed = JSON.parse(rawStored);
    assert.equal(parsed['1m'].currentCandle.open, 24000);
    assert.equal(parsed['5m'].currentCandle.open, 24000);
  });

  it('retrieves timeframe requirements and state from RedisJSON format', async () => {
    const jsonStore = new Map();
    jsonStore.set('strategies:backtest:SBIN', {
      activeStrategies: [
        { name: 'msb_pts', timeframes: ['5m'], data_mode: 'timeframe' },
        { name: 'scalper', timeframe: '15m', data_mode: 'timeframe' },
      ],
    });

    const mockRedisClient = {
      async type(key) {
        return jsonStore.has(key) ? 'ReJSON-RL' : 'none';
      },
      json: {
        async get(key) {
          return jsonStore.get(key) || null;
        },
      },
      async sendCommand([cmd, key]) {
        if (cmd === 'JSON.GET') {
          return JSON.stringify(jsonStore.get(key) || null);
        }
        return null;
      },
      async get(key) {
        return null;
      },
    };

    const persistence = new PersistenceService(mockRedisClient);
    const tfs = await persistence.getTimeframeRequirements('SBIN', true);
    assert.deepEqual(tfs?.sort(), ['15m', '5m'].sort());
  });
});
