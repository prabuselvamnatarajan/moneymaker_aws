const CANONICAL_TIMEFRAME_MAP = {
  '1m': '1m',
  '1minute': '1m',
  '1_minute': '1m',
  '3m': '3m',
  '3minute': '3m',
  '3_minute': '3m',
  '5m': '5m',
  '5minute': '5m',
  '5_minute': '5m',
  '15m': '15m',
  '15minute': '15m',
  '15_minute': '15m',
  '30m': '30m',
  '30minute': '30m',
  '30_minute': '30m',
  '1h': '1h',
  '1hour': '1h',
  '60m': '1h',
  '1d': '1d',
  '1day': '1d',
};

export function normalizeTimeframe(tf) {
  if (!tf) return '1m';
  const clean = String(tf).trim().toLowerCase();
  return CANONICAL_TIMEFRAME_MAP[clean] || clean;
}

export function resolveTopicName(strategyName, isTestMode) {
  return isTestMode
    ? `${strategyName}_backtest_data`
    : `${strategyName}_live_data`;
}

export function extractSymbol(data, rawKey = '') {
  return String(data?.symbol || data?.name || data?.symbolName || rawKey || '').toUpperCase();
}

export function resolvePartitionKey(symbol, strategyOrDeploymentId, isTestMode) {
  const deploymentId = typeof strategyOrDeploymentId === 'object'
    ? strategyOrDeploymentId?.deployment_id
    : strategyOrDeploymentId;
  return isTestMode && deploymentId
    ? `${symbol}:${deploymentId}`
    : symbol;
}

/**
 * Filter and slice a multi-timeframe snapshot down to only the timeframes required
 * by a specific strategy deployment.
 */
export function filterSnapshotForDeployment(snapshot, deployment) {
  if (!snapshot || !snapshot.timeframes) {
    throw new Error('Invalid snapshot: missing timeframes object');
  }
  if (!deployment) {
    throw new Error('deployment is required');
  }

  let requested = [];
  if (Array.isArray(deployment.timeframes) && deployment.timeframes.length > 0) {
    requested = deployment.timeframes.map(normalizeTimeframe);
  } else {
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

export function buildMessagePayload(baseData, strategy, isTestMode, isTimeframeTopic = false) {
  if (isTimeframeTopic && baseData?.timeframes) {
    return filterSnapshotForDeployment(baseData, strategy);
  }
  const strategyData = { ...baseData };
  strategyData.strategy_details = { ...strategy };
  strategyData.strategy_details.isTest = Boolean(isTestMode);
  return strategyData;
}

export const buildStrategyPayload = buildMessagePayload;

export function filterBacktestStrategies(strategies, data) {
  if (!data?.deployment_id) return [];
  return (strategies || []).filter((strategy) => {
    const stratDepId = String(strategy?.deployment_id || strategy?._id || '');
    if (stratDepId !== String(data.deployment_id)) return false;
    if (data.run_id && strategy?.backtest_run_id && String(data.run_id) !== String(strategy.backtest_run_id)) {
      return false;
    }
    return true;
  });
}

export function filterStrategiesForMessage(strategies, isBackTest, data, isTimeframeTopic = null) {
  if (!Array.isArray(strategies)) return [];

  let matching = strategies;

  // If isTimeframeTopic is explicitly boolean, filter by data_mode
  if (isTimeframeTopic === true) {
    matching = matching.filter(s => (s.data_mode || 'timeframe') !== 'tick');
  } else if (isTimeframeTopic === false) {
    matching = matching.filter(s => s.data_mode === 'tick' || !s.data_mode);
  }

  if (!isBackTest) return matching;
  return filterBacktestStrategies(matching, data);
}
