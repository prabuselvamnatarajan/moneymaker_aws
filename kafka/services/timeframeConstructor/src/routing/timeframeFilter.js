import { normalizeTimeframe } from '../core/timeBoundary.js';

/**
 * Filter and slice a multi-timeframe snapshot down to only the timeframes required
 * by a specific strategy deployment.
 *
 * @param {Object} snapshot - Combined multi-timeframe snapshot from timeframe_live_data
 * @param {Object} deployment - Active deployment configuration from Redis
 * @returns {Object} Deployment-tailored snapshot payload
 */
export function filterSnapshotForDeployment(snapshot, deployment) {
  if (!snapshot || !snapshot.timeframes) {
    throw new Error('Invalid snapshot: missing timeframes object');
  }
  if (!deployment) {
    throw new Error('deployment is required');
  }

  // Determine requested timeframes
  let requested = [];
  if (Array.isArray(deployment.timeframes) && deployment.timeframes.length > 0) {
    requested = deployment.timeframes.map(normalizeTimeframe);
  } else if (deployment.timeframe) {
    requested = [normalizeTimeframe(deployment.timeframe)];
  } else {
    // Default fallback to 1m
    requested = ['1m'];
  }

  const filteredTimeframes = {};
  for (const tf of requested) {
    if (snapshot.timeframes[tf]) {
      filteredTimeframes[tf] = snapshot.timeframes[tf];
    }
  }

  const isTestMode = deployment.isTest === true || deployment.strategy_mode === 'BACKTEST';

  return {
    symbol: snapshot.symbol,
    eventTimestamp: snapshot.eventTimestamp,
    snapshotVersion: snapshot.snapshotVersion,
    ltp: snapshot.ltp,
    volume: snapshot.volume,
    timeframes: filteredTimeframes,
    strategy_details: {
      ...deployment,
      isTest: isTestMode,
    },
  };
}

/**
 * Filters strategies for backtest isolation or live distribution.
 *
 * @param {Array} strategies - List of active strategies for symbol
 * @param {boolean} isBackTest - Whether the topic is a backtest topic
 * @param {Object} data - Incoming message data
 * @returns {Array} Filtered list of strategies
 */
export function filterStrategiesForMessage(strategies, isBackTest, data) {
  if (!Array.isArray(strategies)) return [];
  if (!isBackTest) return strategies;
  if (!data || !data.deployment_id) return [];

  return strategies.filter((strategy) => {
    const stratDepId = String(strategy.deployment_id || strategy._id || '');
    if (stratDepId !== String(data.deployment_id)) return false;
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
