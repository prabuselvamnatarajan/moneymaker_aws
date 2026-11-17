import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterStrategiesForMessage,
  resolvePartitionKey,
  resolveTopicName,
  extractSymbol,
  buildMessagePayload,
  filterSnapshotForDeployment,
} from '../topicRoutingHelper.js';

describe('StrategyChooserConsumer Routing & Multi-Deployment Isolation (Real Codebase)', () => {
  const activeStrategiesInRedis = [
    {
      name: 'MSB',
      symbol: 'NIFTY',
      deployment_id: 'dep_111',
      backtest_run_id: 'run_aaa',
      strategy_mode: 'BACKTEST',
      data_mode: 'timeframe',
      timeframes: ['1m', '5m'],
    },
    {
      name: 'MSB',
      symbol: 'NIFTY',
      deployment_id: 'dep_222',
      backtest_run_id: 'run_bbb',
      strategy_mode: 'BACKTEST',
      data_mode: 'timeframe',
      timeframes: ['15m'],
    },
    {
      name: 'scalping',
      symbol: 'NIFTY',
      deployment_id: 'dep_333',
      strategy_mode: 'LIVE',
      data_mode: 'tick',
    },
  ];

  it('routes tick from Deployment 1 strictly to Deployment 1', () => {
    const tickDataD1 = {
      symbol: 'NIFTY',
      ltp: 24000,
      deployment_id: 'dep_111',
      run_id: 'run_aaa',
    };
    const matched = filterStrategiesForMessage(activeStrategiesInRedis, true, tickDataD1);
    assert.equal(matched.length, 1);
    assert.equal(matched[0].deployment_id, 'dep_111');
  });

  it('routes tick from Deployment 2 strictly to Deployment 2', () => {
    const tickDataD2 = {
      symbol: 'NIFTY',
      ltp: 24050,
      deployment_id: 'dep_222',
      run_id: 'run_bbb',
    };
    const matched = filterStrategiesForMessage(activeStrategiesInRedis, true, tickDataD2);
    assert.equal(matched.length, 1);
    assert.equal(matched[0].deployment_id, 'dep_222');
  });

  it('formats partition key with deployment_id for backtest mode to prevent parallel tick interleaving', () => {
    assert.equal(resolvePartitionKey('NIFTY', 'dep_111', true), 'NIFTY:dep_111');
    assert.equal(resolvePartitionKey('NIFTY', 'dep_222', true), 'NIFTY:dep_222');
    assert.notEqual(
      resolvePartitionKey('NIFTY', 'dep_111', true),
      resolvePartitionKey('NIFTY', 'dep_222', true),
      'expected parallel backtests to land on distinct partition keys'
    );
    assert.equal(resolvePartitionKey('NIFTY', 'dep_111', false), 'NIFTY', 'expected live mode to use symbol key');
  });

  it('resolves topic name based on test/live mode', () => {
    assert.equal(resolveTopicName('msb', false), 'msb_live_data');
    assert.equal(resolveTopicName('msb', true), 'msb_backtest_data');
  });

  it('extracts symbol from various payload fields', () => {
    assert.equal(extractSymbol({ symbol: 'nifty' }), 'NIFTY');
    assert.equal(extractSymbol({ name: 'banknifty' }), 'BANKNIFTY');
    assert.equal(extractSymbol({}, 'reliance'), 'RELIANCE');
  });

  it('discards backtest tick if data has no deployment_id', () => {
    const corruptTick = { symbol: 'NIFTY', ltp: 24000 };
    const matched = filterStrategiesForMessage(activeStrategiesInRedis, true, corruptTick);
    assert.equal(matched.length, 0);
  });

  it('discards stale backtest tick if run_id does not match active backtest_run_id', () => {
    const staleTick = {
      symbol: 'NIFTY',
      ltp: 24000,
      deployment_id: 'dep_111',
      run_id: 'old_run_999',
    };
    const matched = filterStrategiesForMessage(activeStrategiesInRedis, true, staleTick);
    assert.equal(matched.length, 0);
  });

  it('passes live timeframe strategies without deployment_id filtering for timeframe topic', () => {
    const matched = filterStrategiesForMessage(activeStrategiesInRedis, false, {}, true);
    assert.equal(matched.length, 2);
    assert.equal(matched[0].deployment_id, 'dep_111');
    assert.equal(matched[1].deployment_id, 'dep_222');
  });

  it('passes live tick strategies for raw tick topic', () => {
    const matched = filterStrategiesForMessage(activeStrategiesInRedis, false, {}, false);
    assert.equal(matched.length, 1);
    assert.equal(matched[0].deployment_id, 'dep_333');
  });

  it('slices combined timeframe snapshot to only the deployment requested intervals', () => {
    const fullSnapshot = {
      symbol: 'NIFTY',
      eventTimestamp: 1720236005000,
      snapshotVersion: 50,
      ltp: 24150,
      volume: 120,
      timeframes: {
        '1m': { open: 24140, high: 24155, low: 24135, close: 24150, isClosed: false },
        '3m': { open: 24120, high: 24155, low: 24110, close: 24150, isClosed: false },
        '5m': { open: 24100, high: 24155, low: 24095, close: 24150, isClosed: false },
        '15m': { open: 24050, high: 24155, low: 24040, close: 24150, isClosed: false },
      },
    };

    // Deployment 1 wants 1m and 5m
    const payloadD1 = buildMessagePayload(fullSnapshot, activeStrategiesInRedis[0], true, true);
    assert.ok(payloadD1.timeframes['1m']);
    assert.ok(payloadD1.timeframes['5m']);
    assert.equal(payloadD1.timeframes['3m'], undefined); // Sliced out!
    assert.equal(payloadD1.timeframes['15m'], undefined); // Sliced out!
    assert.equal(payloadD1.strategy_details.deployment_id, 'dep_111');
    assert.equal(payloadD1.strategy_details.isTest, true);

    // Deployment 2 wants 15m
    const payloadD2 = buildMessagePayload(fullSnapshot, activeStrategiesInRedis[1], true, true);
    assert.ok(payloadD2.timeframes['15m']);
    assert.equal(payloadD2.timeframes['1m'], undefined); // Sliced out!
    assert.equal(payloadD2.timeframes['3m'], undefined); // Sliced out!
    assert.equal(payloadD2.timeframes['5m'], undefined); // Sliced out!
    assert.equal(payloadD2.strategy_details.deployment_id, 'dep_222');
  });

  it('fails loud when filterSnapshotForDeployment receives invalid snapshot or deployment', () => {
    assert.throws(() => filterSnapshotForDeployment(null, {}), /Invalid snapshot/);
    assert.throws(() => filterSnapshotForDeployment({}, {}), /Invalid snapshot/);
    assert.throws(
      () => filterSnapshotForDeployment({ timeframes: {} }, null),
      /deployment is required/
    );
  });

  it('defaults to 1m when deployment has no timeframe or timeframes configured', () => {
    const fullSnapshot = {
      symbol: 'NIFTY',
      timeframes: {
        '1m': { open: 100, close: 100 },
        '5m': { open: 100, close: 100 },
      },
    };
    const deploymentNoTf = {
      deployment_id: 'dep_default',
      name: 'msb',
    };
    const sliced = filterSnapshotForDeployment(fullSnapshot, deploymentNoTf);
    assert.ok(sliced.timeframes['1m']);
    assert.equal(sliced.timeframes['5m'], undefined);
  });

  it('normalizes case and aliases in deployment.timeframes', () => {
    const fullSnapshot = {
      symbol: 'NIFTY',
      timeframes: {
        '1m': { open: 100, close: 100 },
        '5m': { open: 100, close: 100 },
      },
    };
    const deploymentAliases = {
      deployment_id: 'dep_aliases',
      timeframes: ['1Minute', '5M'],
    };
    const sliced = filterSnapshotForDeployment(fullSnapshot, deploymentAliases);
    assert.ok(sliced.timeframes['1m']);
    assert.ok(sliced.timeframes['5m']);
  });

  it('safely handles non-array strategies input in filterStrategiesForMessage', () => {
    assert.deepEqual(filterStrategiesForMessage(null, false, {}), []);
    assert.deepEqual(filterStrategiesForMessage(undefined, true, {}), []);
    assert.deepEqual(filterStrategiesForMessage('not-array', false, {}), []);
  });
});
