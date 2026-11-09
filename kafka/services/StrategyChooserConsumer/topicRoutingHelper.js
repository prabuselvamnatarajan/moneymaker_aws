export function resolveTopicName(strategyName, isTestMode) {
    return isTestMode
        ? `${strategyName}_backtest_data`
        : `${strategyName}_live_data`;
}

export function extractSymbol(data, rawKey = '') {
    return String(data?.symbol || data?.name || data?.symbolName || rawKey || '').toUpperCase();
}

export function buildMessagePayload(baseData, strategy, isTestMode) {
    const strategyData = { ...baseData };
    strategyData.strategy_details = { ...strategy };
    strategyData.strategy_details.isTest = Boolean(isTestMode);
    return strategyData;
}

export function resolvePartitionKey(symbol, strategyOrDeploymentId, isTestMode) {
    const deploymentId = typeof strategyOrDeploymentId === 'object'
        ? strategyOrDeploymentId?.deployment_id
        : strategyOrDeploymentId;
    return isTestMode && deploymentId
        ? `${symbol}:${deploymentId}`
        : symbol;
}

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

export function filterStrategiesForMessage(strategies, isBackTest, data) {
    if (!isBackTest) return strategies || [];
    return filterBacktestStrategies(strategies, data);
}
