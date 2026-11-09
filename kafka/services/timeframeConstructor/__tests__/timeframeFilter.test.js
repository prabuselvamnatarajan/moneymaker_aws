import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterSnapshotForDeployment,
  filterStrategiesForMessage,
} from '../src/routing/timeframeFilter.js';

describe('timeframeFilter - Production Code Tests', () => {
  const fullSnapshot = {
    symbol: 'NIFTY',
    eventTimestamp: 1720236005000,
    snapshotVersion: 10,
    ltp: 24100,
    volume: 50,
    timeframes: {
      '1m': { open: 24090, high: 24105, low: 24085, close: 24100, isClosed: false },
      '3m': { open: 24080, high: 24105, low: 24075, close: 24100, isClosed: false },
      '5m': { open: 24070, high: 24105, low: 24065, close: 24100, isClosed: false },
      '15m': { open: 24050, high: 24105, low: 24040, close: 24100, isClosed: false },
    },
  };

  it('slices snapshot to contain only the timeframes requested by multi-timeframe deployment', () => {
    const deploymentA = {
      deployment_id: 'dep_momentum_01',
      user_id: 'user_123',
      name: 'msb',
      timeframes: ['1m', '5m'],
      isTest: false,
    };

    const resultA = filterSnapshotForDeployment(fullSnapshot, deploymentA);

    assert.equal(resultA.symbol, 'NIFTY');
    assert.equal(resultA.ltp, 24100);
    assert.ok(resultA.timeframes['1m']);
    assert.ok(resultA.timeframes['5m']);
    assert.equal(resultA.timeframes['3m'], undefined); // Stripped!
    assert.equal(resultA.timeframes['15m'], undefined); // Stripped!
    assert.equal(resultA.strategy_details.deployment_id, 'dep_momentum_01');
    assert.equal(resultA.strategy_details.isTest, false);
  });

  it('handles single legacy timeframe configuration (e.g. timeframe: "15m")', () => {
    const deploymentB = {
      deployment_id: 'dep_trend_01',
      user_id: 'user_456',
      name: 'msb_pts',
      timeframe: '15m',
      strategy_mode: 'BACKTEST',
    };

    const resultB = filterSnapshotForDeployment(fullSnapshot, deploymentB);

    assert.ok(resultB.timeframes['15m']);
    assert.equal(resultB.timeframes['1m'], undefined); // Stripped!
    assert.equal(resultB.timeframes['3m'], undefined); // Stripped!
    assert.equal(resultB.timeframes['5m'], undefined); // Stripped!
    assert.equal(resultB.strategy_details.isTest, true); // BACKTEST mode marked as isTest
  });

  it('fails loud when snapshot or deployment is missing', () => {
    assert.throws(() => filterSnapshotForDeployment(null, {}), /Invalid snapshot/);
    assert.throws(() => filterSnapshotForDeployment({}, {}), /Invalid snapshot/);
    assert.throws(() => filterSnapshotForDeployment(fullSnapshot, null), /deployment is required/);
  });

  it('filters strategies for backtest isolation matching deployment_id and run_id', () => {
    const activeStrategies = [
      { deployment_id: 'dep_1', backtest_run_id: 'run_A' },
      { deployment_id: 'dep_2', backtest_run_id: 'run_B' },
    ];

    // Live mode passes all
    const liveFiltered = filterStrategiesForMessage(activeStrategies, false, {});
    assert.equal(liveFiltered.length, 2);

    // Backtest mode matches deployment_id
    const d1Msg = { deployment_id: 'dep_1', run_id: 'run_A' };
    const matchedD1 = filterStrategiesForMessage(activeStrategies, true, d1Msg);
    assert.equal(matchedD1.length, 1);
    assert.equal(matchedD1[0].deployment_id, 'dep_1');

    // Stale backtest run_id is discarded
    const staleMsg = { deployment_id: 'dep_1', run_id: 'run_OLD' };
    const matchedStale = filterStrategiesForMessage(activeStrategies, true, staleMsg);
    assert.equal(matchedStale.length, 0);

    // Missing deployment_id in backtest returns empty array
    assert.equal(filterStrategiesForMessage(activeStrategies, true, {}).length, 0);
  });
});
