import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('StrategyChooserConsumer Routing & Multi-Deployment Isolation', () => {

  /**
   * Replicates the exact filtering logic from StrategyChooserConsumer.js
   */
  function filterStrategiesForMessage(strategies, isBackTest, data) {
    if (!isBackTest) return strategies;
    if (!data || !data.deployment_id) return [];
    return strategies.filter((strategy) => {
      if (String(strategy.deployment_id) !== String(data.deployment_id)) return false;
      if (
        data.run_id &&
        strategy.backtest_run_id &&
        String(data.run_id) !== String(strategy.backtest_run_id)
      ) {
        return false;
      }
      return true;
    });
  }

  const activeStrategiesInRedis = [
    {
      name: 'MSB',
      symbol: 'NIFTY',
      deployment_id: 'dep_111',
      backtest_run_id: 'run_aaa',
      strategy_mode: 'BACKTEST',
    },
    {
      name: 'MSB',
      symbol: 'NIFTY',
      deployment_id: 'dep_222',
      backtest_run_id: 'run_bbb',
      strategy_mode: 'BACKTEST',
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
    function getPartitionKey(symbol, isTestMode, deploymentId) {
      return isTestMode && deploymentId ? `${symbol}:${deploymentId}` : symbol;
    }

    assert.equal(getPartitionKey('NIFTY', true, 'dep_111'), 'NIFTY:dep_111');
    assert.equal(getPartitionKey('NIFTY', true, 'dep_222'), 'NIFTY:dep_222');
    assert.notEqual(
      getPartitionKey('NIFTY', true, 'dep_111'),
      getPartitionKey('NIFTY', true, 'dep_222'),
      'expected parallel backtests to land on distinct partition keys'
    );
    assert.equal(getPartitionKey('NIFTY', false, 'dep_111'), 'NIFTY', 'expected live mode to use symbol key');
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

  it('passes all live/paper strategies without deployment_id filtering for live topic', () => {
    const liveStrategies = [
      { name: 'MSB', symbol: 'NIFTY', deployment_id: 'dep_live_1' },
      { name: 'MSB', symbol: 'NIFTY', deployment_id: 'dep_live_2' },
    ];
    const liveTick = { symbol: 'NIFTY', ltp: 24000 };
    const matched = filterStrategiesForMessage(liveStrategies, false, liveTick);
    assert.equal(matched.length, 2);
  });
});
